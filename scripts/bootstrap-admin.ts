/**
 * 管理者ブートストラップ (設計書 §3.3 / §6.3)。
 *
 * Supabase Auth の public signup は無効化する前提のため、管理者アカウントは
 * このスクリプト (service role) が auth.users + profiles を同時作成する。
 * 併せて site_settings 'notifications'.inquiry_to を同じメールアドレスで初期化する
 * (通知先未設定のまま運用が始まる事故を防ぐ、設計書 §6.3)。
 *
 * 冪等性: 既に同じメールの auth.users / 対応する profiles / notifications 設定が
 * 存在する場合はそれぞれスキップして報告する (再実行安全)。
 *
 * 使い方:
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_PASSWORD='...' \
 *     npx tsx scripts/bootstrap-admin.ts
 *
 * 必要 env:
 *   - NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (通常の必須 env と共通)
 *   - BOOTSTRAP_ADMIN_EMAIL (必須)
 *   - BOOTSTRAP_ADMIN_PASSWORD (必須。初回ログイン用パスワード)
 *   - BOOTSTRAP_ADMIN_NAME (任意。profiles.display_name。未指定時はメールのローカル部を使用)
 */
import { zNotificationSettings } from "@/modules/settings/contracts";

import { createScriptServiceClient } from "./lib/service-client";

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const displayName = process.env.BOOTSTRAP_ADMIN_NAME ?? email?.split("@")[0] ?? "管理者";

  if (!email || !password) {
    console.error(
      "BOOTSTRAP_ADMIN_EMAIL と BOOTSTRAP_ADMIN_PASSWORD の両方を env で指定してください。",
    );
    process.exitCode = 1;
    return;
  }

  const supabase = await createScriptServiceClient();

  // ---- 1. auth.users ----
  let userId: string | undefined;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    const alreadyExists = /already.*registered|already.*exists/i.test(createError.message);
    if (!alreadyExists) {
      console.error("auth.users の作成に失敗しました:", createError.message);
      process.exitCode = 1;
      return;
    }
    // 既存ユーザーを検索する (supabase-js admin API に getUserByEmail が無いため list + find)
    const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listError) {
      console.error("既存ユーザーの検索に失敗しました:", listError.message);
      process.exitCode = 1;
      return;
    }
    const existing = listed.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) {
      console.error(
        `auth.users に ${email} が既に存在すると報告されましたが、一覧から見つかりませんでした。`,
      );
      process.exitCode = 1;
      return;
    }
    userId = existing.id;
    console.log(`[skip] auth.users: ${email} は既に存在します (id=${userId})`);
  } else {
    userId = created.user.id;
    console.log(`[created] auth.users: ${email} (id=${userId})`);
  }

  // ---- 2. profiles ----
  const { data: existingProfile, error: profileSelectError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (profileSelectError) {
    console.error("profiles の確認に失敗しました:", profileSelectError.message);
    process.exitCode = 1;
    return;
  }

  if (existingProfile) {
    console.log(`[skip] profiles: id=${userId} は既に存在します`);
  } else {
    const { error: profileInsertError } = await supabase.from("profiles").insert({
      id: userId,
      display_name: displayName,
      role: "admin",
    });
    if (profileInsertError) {
      console.error("profiles の作成に失敗しました:", profileInsertError.message);
      process.exitCode = 1;
      return;
    }
    console.log(`[created] profiles: id=${userId}, display_name=${displayName}`);
  }

  // ---- 3. site_settings 'notifications' ----
  const { data: existingSettings, error: settingsSelectError } = await supabase
    .from("site_settings")
    .select("key")
    .eq("key", "notifications")
    .maybeSingle();

  if (settingsSelectError) {
    console.error("site_settings の確認に失敗しました:", settingsSelectError.message);
    process.exitCode = 1;
    return;
  }

  if (existingSettings) {
    console.log("[skip] site_settings.notifications: 既に設定済みです (上書きしません)");
  } else {
    const value = zNotificationSettings.parse({
      inquiry_to: email,
      on_publish_failure: false,
    });
    const { error: settingsUpsertError } = await supabase
      .from("site_settings")
      .upsert({ key: "notifications", value, updated_by: userId });
    if (settingsUpsertError) {
      console.error("site_settings.notifications の初期化に失敗しました:", settingsUpsertError.message);
      process.exitCode = 1;
      return;
    }
    console.log(`[created] site_settings.notifications: inquiry_to=${email}`);
  }

  console.log("完了しました。");
}

main().catch((err) => {
  console.error("予期しないエラー:", err);
  process.exitCode = 1;
});
