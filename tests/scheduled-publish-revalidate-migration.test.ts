import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 予約公開の revalidate 起床ジョブ (migration 20260906000060_scheduled_publish_revalidate.sql、
 * canonical: docs/design/cms-ai-pipeline.md §6.1)。
 *
 * 実 DB は使えないため、contracts-ddl-parity.test.ts と同じく SQL ファイルを静的に検査し、
 * (1) 毎分 cron が登録されること、(2) works/posts/voices の 3 テーブルを published_at 到来窓で
 * 見ること、(3) 送る tag が公開側 unstable_cache のタグ体系 (works / posts:{kind} / voices) と
 * 一致すること、(4) /api/revalidate を x-revalidate-secret 付きで叩き、secret/URL は Vault から
 * 取ること (trigger_publish_worker と同じ流儀) を固定する。
 */

const SQL = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260906000060_scheduled_publish_revalidate.sql"),
  "utf8",
);

describe("20260906000060_scheduled_publish_revalidate.sql", () => {
  it("毎分の cron ジョブ kmb-scheduled-publish-revalidate を張り替え登録する", () => {
    expect(SQL).toMatch(/cron\.unschedule\(jobid\) from cron\.job where jobname = 'kmb-scheduled-publish-revalidate'/);
    expect(SQL).toMatch(/cron\.schedule\(\s*'kmb-scheduled-publish-revalidate',\s*'\* \* \* \* \*'/);
    expect(SQL).toContain("select public.trigger_scheduled_publish_revalidate();");
  });

  it("works / posts / voices の published_at 到来分 (窓内かつ now() 以下) を見る", () => {
    for (const table of ["works", "posts", "voices"]) {
      const block = new RegExp(
        `from ${table}\\s+where status = 'published'\\s+and published_at > now\\(\\) - v_window\\s+and published_at <= now\\(\\)`,
      );
      expect(SQL, `${table} の到来判定`).toMatch(block);
    }
    expect(SQL).toMatch(/v_window interval := interval '2 minutes'/);
  });

  it("送る tag は公開側キャッシュのタグ体系 (works / posts:{kind} / voices) と一致する", () => {
    expect(SQL).toContain("select 'works'::text as tag");
    expect(SQL).toContain("select 'posts:' || kind");
    expect(SQL).toContain("select 'voices'::text");
  });

  it("/api/revalidate を x-revalidate-secret 付きで net.http_post し、URL/secret は Vault から取る", () => {
    expect(SQL).toMatch(/url := v_url \|\| '\/api\/revalidate'/);
    expect(SQL).toContain("'x-revalidate-secret', v_secret");
    expect(SQL).toContain("body := jsonb_build_object('tags', to_jsonb(v_tags))");
    expect(SQL).toContain("from vault.decrypted_secrets where name = 'cron_site_url'");
    expect(SQL).toContain("from vault.decrypted_secrets where name = 'cron_revalidate_secret'");
    // 未設定時は skip (raise notice) で落とさない
    expect(SQL).toMatch(/if v_url is null or v_secret is null then\s+raise notice/);
  });

  it("関数は security definer で、public/anon/authenticated から execute を剥奪する", () => {
    expect(SQL).toMatch(/create or replace function public\.trigger_scheduled_publish_revalidate\(\)[\s\S]*security definer/);
    expect(SQL).toContain(
      "revoke execute on function public.trigger_scheduled_publish_revalidate() from public, anon, authenticated;",
    );
  });
});

describe("20260906000061_work_images_replace.sql", () => {
  const RPC_SQL = readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260906000061_work_images_replace.sql"),
    "utf8",
  );

  it("work_images_replace(uuid, uuid[]) は security definer + is_admin() ガードで delete + insert を 1 関数にまとめる", () => {
    expect(RPC_SQL).toMatch(/create or replace function public\.work_images_replace\(p_work_id uuid, p_media_ids uuid\[\]\)/);
    expect(RPC_SQL).toMatch(/security definer/);
    expect(RPC_SQL).toMatch(/if not public\.is_admin\(\) then/);
    expect(RPC_SQL).toContain("delete from work_images where work_id = p_work_id;");
    expect(RPC_SQL).toMatch(/insert into work_images \(work_id, media_id, sort_order\)[\s\S]*with ordinality/);
  });

  it("FK 違反は KMB-E101 として raise し、anon からの execute は剥奪する", () => {
    expect(RPC_SQL).toMatch(/when foreign_key_violation then\s+[\s\S]*raise exception 'KMB-E101/);
    expect(RPC_SQL).toContain("revoke execute on function public.work_images_replace(uuid, uuid[]) from public, anon;");
    expect(RPC_SQL).toContain("grant execute on function public.work_images_replace(uuid, uuid[]) to authenticated;");
  });
});
