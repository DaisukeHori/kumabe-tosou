import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SettingsTabs, type SettingsTabsData } from "@/app/admin/settings/settings-forms";

/**
 * canonical: GitHub Issue #92 「通話設定への誘導リンクを設定画面の『電話』タブへ直接
 * ディープリンクさせる」。
 *
 * settings-forms.tsx の SettingsTabs は "use client" だが、"use server" ファイル (actions.ts /
 * ai-actions.ts / calls/actions.ts) を import 時点で評価しても副作用 (facade 呼び出し等) は
 * 発生しない (関数本体内でのみ facade を参照する) ため、tests/page-body-text-editmode.test.ts と
 * 同じ手法 (renderToStaticMarkup で直接レンダーし、モックなしで import する) がそのまま使える。
 *
 * Base UI の TabsPanel はデフォルトで keepMounted=false であり、初回レンダー時の mounted 初期値は
 * `value === selectedValue` (active tab) と等しい (node_modules/@base-ui/react の実装参照) ため、
 * renderToStaticMarkup の出力には「初期アクティブなタブの中身だけ」が現れる。これを利用して
 * initialTab プロップの検証(ホワイトリスト採用/フォールバック)を SSR 出力のみで検証できる。
 *
 * タブ切替時の window.history.replaceState 同期 (onValueChange) は jsdom 等の DOM 環境が
 * このリポジトリの vitest 設定 (environment: "node") に無く、クリック操作をシミュレートできないため
 * 自動テストの対象外とする (受入基準のうち該当項目は手動/ビルド確認で担保する)。
 */

function unset<T>(): { value: T | null; updatedAt: string | null; isUnset: boolean } {
  return { value: null, updatedAt: null, isUnset: true };
}

const DATA: SettingsTabsData = {
  company: unset(),
  hero: unset(),
  seo_defaults: unset(),
  analytics: unset(),
  branding: unset(),
  ops_limits: unset(),
  notifications: unset(),
  work_capacity: unset(),
  telephony: unset(),
  business_hours: unset(),
  invoice_issuer: unset(),
};

const TELEPHONY_SETUP_STATUS = {
  envConfigured: true,
  numberConfigured: true,
  forwardConfigured: true,
  staleJobs: 0,
};

function renderTabs(initialTab: string | undefined): string {
  return renderToStaticMarkup(
    createElement(SettingsTabs, {
      data: DATA,
      initialTab,
      aiKeys: [],
      telephonySetupStatus: TELEPHONY_SETUP_STATUS,
      siteUrl: "https://example.com",
      sealPreviewUrl: null,
      mediaCatalog: [],
      mediaNextCursor: null,
    }),
  );
}

// 各タブに一意な marker (フォームの id / ラベル文言) を対応付ける。
// 会社情報タブのみ他タブに現れない文言 "代表者名" を「フォールバック検証」用に別途使う。
const TAB_MARKERS: Record<string, string> = {
  company: "company-representative",
  hero: "hero-heading",
  seo_defaults: "seo-title-template",
  analytics: "analytics-ga4-id",
  branding: "サイトのタブに表示されるアイコン",
  ops_limits: "ops-x-limit",
  notifications: "notif-inquiry-to",
  work_capacity: "work-capacity-weekly-hours",
  telephony: "転送先電話番号",
  business_hours: "臨時休業日",
  invoice_issuer: "ii-issuer-name",
  ai: "プロバイダキー管理",
};

const ALL_MARKERS = Object.values(TAB_MARKERS);

describe("SettingsTabs: initialTab による ?tab= ディープリンク (#92)", () => {
  it.each(Object.entries(TAB_MARKERS))(
    "initialTab=%s のとき該当タブの中身だけが初期表示される",
    (tabKey, marker) => {
      const html = renderTabs(tabKey);
      expect(html).toContain(marker);
      // 他タブの marker は (Base UI の keepMounted=false デフォルトにより) 出力されない
      for (const other of ALL_MARKERS) {
        if (other === marker) continue;
        expect(html).not.toContain(other);
      }
    },
  );

  it("initialTab 未指定 (ナビの「サイト設定」経由/デフォルト) は会社情報タブにフォールバックする", () => {
    const html = renderTabs(undefined);
    expect(html).toContain(TAB_MARKERS.company);
    expect(html).not.toContain(TAB_MARKERS.telephony);
  });

  it("initialTab が未知の値 (?tab=foo) の場合もクラッシュせず会社情報タブにフォールバックする", () => {
    const html = renderTabs("foo");
    expect(html).toContain(TAB_MARKERS.company);
    expect(html).not.toContain(TAB_MARKERS.telephony);
  });

  it("initialTab が空文字の場合も会社情報タブにフォールバックする", () => {
    const html = renderTabs("");
    expect(html).toContain(TAB_MARKERS.company);
  });

  // 敵対的レビュー指摘: `initialTab in TAB_LABELS` は Object.prototype 継承プロパティにもマッチする。
  // ?tab=constructor 等では active が "constructor" になり、TabsTrigger/TabsContent のどれとも
  // 一致しないため会社情報タブへのフォールバックが破られ (タブ内容が完全に空白レンダリング)、
  // かつ Cmd+S 押下時 formRefs.current["constructor"] がプロトタイプ継承の Object コンストラクタを
  // 掴み requestSubmit is not a function で例外化しうる。hasOwnProperty ベースの検証で防ぐ。
  it.each(["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"])(
    "initialTab=%s (Object.prototype 継承プロパティ名) でも会社情報タブにフォールバックする",
    (tabKey) => {
      const html = renderTabs(tabKey);
      expect(html).toContain(TAB_MARKERS.company);
      expect(html).not.toContain(TAB_MARKERS.telephony);
    },
  );

  it("initialTab=telephony は SetupChecklist (Webhook URL) を含む電話タブを初期表示する", () => {
    const html = renderTabs("telephony");
    expect(html).toContain("セットアップチェックリスト");
    expect(html).toContain("Twilio コンソールに設定する Webhook URL");
    expect(html).toContain(TAB_MARKERS.telephony);
  });
});
