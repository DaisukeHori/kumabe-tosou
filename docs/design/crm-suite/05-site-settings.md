# 隈部塗装 CRM スイート — サイト設定 (site-settings) 設計書 (05)

- 版: v1.2 (2026-07-11: 07 §D5 v1.2 (角印 private 化 — seal_media_id 廃止・0028 内容置換) への追随 — §2.2/§2.5 の seal_media_id 条件と 0028↔0035 逆時系列運用規則 (裁定 #21) を前提消滅により撤回・整理。詳細は更新履歴)。旧: v1.1 (2026-07-11: レビュー反映 — 本番 seo_defaults 行の実在対応 / og メタの fallback 意味論是正 / 0028↔0035 適用順運用 / 破損行復旧経路 ほか)
- 旧版: v1.0 (2026-07-11: 初版 — 設計裁定 J12 準拠)
- 作成: Fable 5 (設計サブエージェント、model=opus 系)
- 位置づけ: **settings 既存拡張のうち analytics (GA4)・branding (favicon)・seo_defaults 公開側配線・OGP 寸法是正・robots 追記の詳細設計の正**。親設計 = [00-overview.md](./00-overview.md) (§2.1 settings / §5.3 / §10)。
- canonical 分担:
  - settings キーの **Zod canonical は [07-contracts-delta.md](./07-contracts-delta.md) §D5** (統合後は docs/module-contracts.md §4.2)。本書は転記のみで再定義しない
  - **migration 0035 の DDL 全文は本書 §2.2 が canonical**
  - site_settings テーブル自体の DDL は migration 0001 / cms-ai-pipeline.md §2 が正 (本書は変更しない)
  - invoice_issuer / business_hours / work_capacity キーの**実装**は各フェーズ (02-sales / 04-telephony / 03-scheduling)。**所有は settings のまま** (00-overview §2.1)
- 入力資料: 設計ブリーフ R5・設計裁定書 J12 (+J1/J11)・調査 site-meta.md / db-schema.md / admin-ui-auth.md / design-conventions.md / **gap-prod-db.md (本番実データ — §13.1 の前提。v1.1 で追加)**。実コード裏取り済み (2026-07-11): `src/app/layout.tsx` / `src/app/(site)/layout.tsx` / `src/app/robots.ts` / `src/modules/settings/{contracts,facade,repository}.ts` / `src/modules/media/facade.ts` / `src/app/admin/settings/*` / `src/app/admin/_ui/{media-picker,media-picker-data}.tsx|ts` / migration 0015 §7-8 / 0017 / `public/og-image.jpg` (sips 実測 1400x787) / `scripts/seed-data/settings.ts`
- 対象リポジトリ: DaisukeHori/kumabe-tosou (Next.js 15 App Router + Vercel hnd1 + Supabase `ixvfhxbfpdquwktsnmqy`)
- 前提: Phase 1 (M0 契約統合 — 07-contracts-delta §D5 の SETTINGS_SCHEMAS 6 キー (v1.1 で telephony キー追加) が settings/contracts.ts に反映済み) の後に着手する。migration は **0035 のみ** (帯固定、00-overview §10)

---

## 0. 業務シナリオ

熊部さん (塗装職人) の視点で、本モジュールが何を変えるかを 4 部で描く。IT 用語は使わない。

### 0.1 「お店の看板を自分で掛け替えられる」

熊部さんが新しいロゴを作ってもらった。いままでサイトのタブに出る小さなマークを変えるには開発者にお願いするしかなかったが、これからは管理画面の「サイト設定」を開き、「ブランディング」の欄で画像を選んで保存するだけ。数分後にはお客さんのブラウザのタブに新しいマークが出る。使っている画像は誤って消せないよう守られていて、「この画像は看板に使っています」と教えてくれる。

### 0.2 「検索とシェアで正しく見える」

お客さんが LINE や X でサイトの URL を送り合うとき、リンクの下に出る紹介文とサムネイル画像がある。いままでこれはプログラムの中に書き込まれていて変えられなかった。これからは管理画面の「SEO既定値」で紹介文とサムネイル画像を書き換えられ、保存すればサイト全体にすぐ反映される。画像は一覧から選ぶだけで、サイズの目安が合っていないときは保存時に教えてくれる。

### 0.3 「何人来たか、が分かるようになる」

「サイトを作り替えてから問い合わせが増えた気がする」— 気がする、ではなく数字で分かるようにする。管理画面の「計測」に Google からもらった番号 (G- で始まるもの) を貼り付けて保存すると、その日からサイトの訪問者数・よく見られているページが Google のレポートで見られるようになる。熊部さんや堀さんが管理画面で作業している分は数に混ざらない。番号を消せば計測はすぐ止まる。

### 0.4 「設定しなくても壊れない」

これらは全部「設定したら効く、設定しなければ今まで通り」という作りになっている。計測の番号が空ならタグは一切入らない。看板画像を選んでいなければ従来のマークがそのまま出る。紹介文を保存していなければ、いま表示されている文章が出続ける。設定の保存に失敗してもサイトの表示は絶対に壊れない。

### 0.5 スコープ外 (本書で扱わないもの)

| 項目 | 理由・扱い |
|---|---|
| invoice_issuer / business_hours / work_capacity / telephony の管理 UI・消費側 | 所有は settings、Zod canonical は 07-contracts-delta §D5 (telephony キーは v1.1 で追加) だが、実装は 02-sales / 04-telephony / 03-scheduling の各フェーズ (00-overview §10) |
| apple-touch-icon / PWA manifest / favicon 多サイズセット | 現状どちらも存在しない (site-meta §2)。v1 は `<link rel="icon">` 1 本のみ。需要が出たら /icon Route Handler に `?size=` を足す拡張余地を §5.3 に明記 |
| ページ別 SEO 上書きの器 (ページごとの title/description DB 化) | 既存ページの静的 metadata / generateMetadata で充足 (§5.7)。全ページ一律の既定値配線のみ |
| GTM (Google Tag Manager) / Cookie 同意バナー / CSP 追加 | GA4 単体のみ (J12)。CSP は現状未設定で調整不要 (site-meta §3.2)。同意バナーは国内個人工房サイトの現行運用を踏襲し導入しない (導入判断は堀さん事項) |
| LocalBusiness JSON-LD の本格 DB 化 (company 設定との配線) | description 1 項目のみ本書で配線 (§5.2)。住所・社名等の配線は別途 (site-meta 未解決疑問 3) |
| 独自ドメイン / Search Console 登録 | 運用作業 (00-overview §12.1 C3/C5)。設計は vercel.app のままでも動く形 |

### 0.6 印刷出力

**該当なし。** 本モジュールに帳票・印刷物の出力要件は存在しない (帳票 PDF は 02-sales.md §印刷出力が正)。接点は 1 点のみ: sales が新設する印刷専用ルート `/print` を検索エンジンから隠すための `robots.ts` への disallow 追記を**本書の Issue が担う** (00-overview §5.3、§5.5 参照)。

---

## 1. スコープと確定裁定 (裁定 J12 の展開)

| # | 項目 | 裁定 | 本書の対応箇所 |
|---|---|---|---|
| S1 | SETTINGS_SCHEMAS に `analytics` (ga4_measurement_id) キー追加 | ✅ (J12) | §3.1 (D5 転記)・§6 (UI) |
| S2 | GA タグは `(site)/layout.tsx` のみに `@next/third-parties` で注入 (admin/edit 除外・**root layout 変更不可**) | ✅ (J12) | §5.1 |
| S3 | seo_defaults の公開側配線 (generateMetadata 化、createSupabasePublicClient + unstable_cache 作法) | ✅ (J12) | §5.2・§4.1 |
| S4 | favicon は media_id 方式 (`branding` キー新設)。App Router ファイル規約 → 動的 Route Handler (/icon) 移行 | ✅ (J12) | §5.3・§4.4 |
| S5 | favicon の media 参照 3 点セット追記 (media_admin_delete / media_reference_summary / ai_draft_cleanup_run) = migration 0035 | ✅ (J12) | §2.2 |
| S6 | og-image.jpg 宣言寸法 1200x630 vs 実寸 1400x787 の不整合是正 | ✅ (J12) | §5.4 |
| S7 | robots.ts へ `/print` disallow 追記 | ✅ (00-overview §5.3) | §5.5 |
| S8 | seo_defaults タブの og_media_id 入力を生 uuid テキスト → MediaPicker 化 | ✅ (公開側配線の付帯是正。site-meta §7-1 の欠落 (b)) | §6.2 |
| S9 | ページ別メタは既存実装を変更しない (一覧と相互作用の明文化のみ) | ✅ | §5.7 |

**依存**: Phase 1 (M0 契約統合) のみ。crm/sales/scheduling/telephony と独立に着手可 (00-overview §11 Phase 4 #4-1)。migration 0035 は 0015/0017 (置換元) の後であればいつでも適用可 (v1.2 — 旧「0028 と同一オブジェクトを置換するため番号順適用が必須」は、07 §D5 v1.2 の角印 private 化で 0028 が 3 点セットを触らなくなり前提消滅。§2.5)。

---

## 2. データモデル (migration 0035 / site_settings キー追加)

### 2.1 所有テーブル

**新規テーブルなし。** 本モジュールが触る永続化は次の 2 種のみ:

1. `site_settings` への**キー追加** (`analytics` / `branding`) — 既存規約どおり **DDL 不要** (key text PK + value jsonb の汎用構造。db-schema §2.3「新設定キーの追加規約」)。テーブル DDL の canonical は migration 0001 / cms-ai-pipeline.md §2 で不変
2. **media 参照 3 点セットの置換** (migration 0035、§2.2) — `branding.favicon_media_id` が media を参照するため、参照ガード義務 (db-schema §8-12) を履行する

**バックフィル UPDATE も行わない** (§2.4 に根拠)。

### 2.2 migration 0035 全文 (canonical: 本節)

```sql
-- 20260711000035_branding_favicon_media_refs.sql
-- canonical: docs/design/crm-suite/05-site-settings.md §2.2 (裁定 J12 / 00-overview §10)
--
-- 本 migration が行うこと:
--   site_settings.branding.favicon_media_id (07-contracts-delta §D5) が media を参照するため、
--   media 参照 3 点セット (db-schema 調査 §8-12 の義務) に favicon_media_id チェックを追加する。
--   view / policy の再定義は DROP+CREATE 置換 (0008→0013→0015 の確立前例)。
--   1) media_admin_delete RLS ポリシーの置換
--   2) media_reference_summary view の置換
--   3) ai_draft_cleanup_run 関数の create or replace
--
-- 本 migration が行わないこと:
--   - site_settings のスキーマ変更 (キー追加は contracts.ts のみで DDL 不要)
--   - 'analytics' / 'branding' 行のシード INSERT (行なし = 既定 (null) の意味論。
--     05-site-settings.md §2.4 — page_media/page_text と同じ「差分のみ DB」原則)
--
-- 0028 (02-sales.md) との関係 (v1.2 整理): **なし**。旧 0028 (seal_media_id の 3 点セット置換) は
--   07-contracts-delta §D5 v1.2 (角印の branding-assets private バケット化 — seal_storage_path) により
--   「branding-assets バケット作成」に内容置換され (02-sales §2.3.3 v1.2)、media 参照 3 点セットを
--   置換する migration は本 0035 のみになった。seal_media_id は存在しない設計要素のため
--   条件を追加しない (旧 v1.1 の「0028 包含 + 逆時系列適用禁止」運用規則は前提消滅で撤回 — §2.5)。

-- =========================================================
-- 1) media_admin_delete RLS (現行: 20260710000015 §7) の DROP+CREATE 置換
--    追加: site_settings チェックに favicon_media_id (v1.2 — seal_media_id は 07 §D5 v1.2 で
--    廃止された設計要素のため追加しない)
-- =========================================================
drop policy if exists media_admin_delete on media;

create policy media_admin_delete on media
  for delete
  using (
    public.is_admin()
    and not exists (select 1 from work_images wi where wi.media_id = media.id)
    and not exists (select 1 from works w where w.cover_media_id = media.id)
    and not exists (select 1 from posts p where p.cover_media_id = media.id)
    and not exists (select 1 from voices v where v.photo_media_id = media.id)
    and not exists (
      select 1 from site_settings s
      where s.value @> jsonb_build_object('media_id', media.id::text)
         or s.value @> jsonb_build_object('og_media_id', media.id::text)
         or s.value @> jsonb_build_object('favicon_media_id', media.id::text)
    )
    and not exists (select 1 from page_media pm where pm.media_id = media.id)
    and not exists (select 1 from ai_image_generations aig where aig.media_id = media.id)
    and not exists (select 1 from ai_image_generation_sources aigs where aigs.media_id = media.id)
  );

-- =========================================================
-- 2) media_reference_summary view (現行: 20260710000015 §8) の DROP+CREATE 置換
--    (media_admin_delete と参照集合を常に一致させる — 確立規約)
-- =========================================================
drop view if exists public.media_reference_summary;

create view public.media_reference_summary
with (security_invoker = true) as
select
  m.id as media_id,
  (
    (select count(*) from work_images wi where wi.media_id = m.id)
    + (select count(*) from works w where w.cover_media_id = m.id)
    + (select count(*) from posts p where p.cover_media_id = m.id)
    + (select count(*) from voices v where v.photo_media_id = m.id)
    + (
        select count(*) from site_settings s
        where s.value @> jsonb_build_object('media_id', m.id::text)
           or s.value @> jsonb_build_object('og_media_id', m.id::text)
           or s.value @> jsonb_build_object('favicon_media_id', m.id::text)
      )
    + (select count(*) from page_media pm where pm.media_id = m.id)
    + (select count(*) from ai_image_generations aig where aig.media_id = m.id)
    + (select count(*) from ai_image_generation_sources aigs where aigs.media_id = m.id)
  )::int as reference_count
from media m;

grant select on public.media_reference_summary to anon, authenticated;

-- =========================================================
-- 3) ai_draft_cleanup_run (現行: 20260710000017) の create or replace
--    追加: site_settings チェックに favicon_media_id (v1.2 — seal_media_id は追加しない)
--    (0017 の教訓を維持: delete 対象に md エイリアス必須 — RETURNS TABLE の
--     storage_path 出力列との ambiguity 回避)
-- =========================================================
create or replace function public.ai_draft_cleanup_run(p_cutoff timestamptz default now() - interval '7 days')
returns table (media_id uuid, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select m.id, m.storage_path
    from media m
    where m.tags @> array['ai-draft']
      and m.created_at < p_cutoff
      and exists (
        select 1 from ai_image_generations aig
        where aig.media_id = m.id and aig.is_selected = false
      )
      and not exists (select 1 from work_images wi where wi.media_id = m.id)
      and not exists (select 1 from works w where w.cover_media_id = m.id)
      and not exists (select 1 from posts p where p.cover_media_id = m.id)
      and not exists (select 1 from voices v where v.photo_media_id = m.id)
      and not exists (
        select 1 from site_settings s
        where s.value @> jsonb_build_object('media_id', m.id::text)
           or s.value @> jsonb_build_object('og_media_id', m.id::text)
           or s.value @> jsonb_build_object('favicon_media_id', m.id::text)
      )
      and not exists (select 1 from page_media pm where pm.media_id = m.id)
      and not exists (select 1 from ai_image_generation_sources aigs where aigs.media_id = m.id)
  )
  delete from media md
  where md.id in (select id from candidates)
  returning md.id, md.storage_path;
end;
$$;

revoke execute on function public.ai_draft_cleanup_run(timestamptz) from public, anon, authenticated;
```

注記:

- RPC 権限は 0017 の service 専用型を維持 (revoke のみ・ガード節なし・service_role は revoke の影響を受けない)
- 本 migration に RETURNS TABLE の新規 PL/pgSQL はなく (`ai_draft_cleanup_run` は 0017 の md エイリアス方式を踏襲)、`#variable_conflict use_column` の追加は不要 (既存関数のスタイルを変えない)
- 本番適用は HANDOFF §3 の手動 apply 運用 (Supabase MCP / Dashboard SQL Editor)。適用順は 0021〜0034 の後

### 2.3 JSONB カラム ↔ 型契約対応表 (本書の関与分)

| カラム | キー | canonical スキーマ | 実装フェーズ | 消費者 |
|---|---|---|---|---|
| site_settings.value | `analytics` | `zAnalyticsSettings` (07-contracts-delta §D5) | **本書** | (site)/layout.tsx (GA 注入) / admin 設定タブ |
| site_settings.value | `branding` | `zBrandingSettings` (同 §D5) | **本書** | (site)/layout.tsx (icons メタ) / GET /icon / admin 設定タブ |
| site_settings.value | `seo_defaults` | `zSeoDefaults` (既存 — module-contracts §4.2。**変更なし**) | 公開側配線のみ本書 | (site)/layout.tsx generateMetadata / admin 設定タブ (MediaPicker 化) |
| site_settings.value | `invoice_issuer` / `business_hours` / `work_capacity` | 同 §D5 | 02-sales / 04-telephony / 03-scheduling | 本書スコープ外 (§0.5) |

### 2.4 シード / バックフィルを行わない根拠

`analytics` / `branding` とも「null = 機能無効」が既定であり、**行が存在しない = 既定値** という意味論で完全に表現できる (page_media / page_text の「差分のみ DB」原則と同型)。既存の `settingsFacade.getWithMeta` は行なしを `isUnset: true` で返し admin UI の初回保存を成立させる実装が既にあり (settings/facade.ts L67-72 実測)、公開側の新設読み取り (§4.1 `getPublicValue`) も行なしを `null` で返す。0015 の ops_limits バックフィル前例は「既存行への必須キー追加」だったのに対し、本件は「新規行 + 全フィールド nullable 既定」であるためバックフィルの必然がない。00-overview §10 の割当「0035 は favicon の media 参照 3 点セットのみ」とも一致する。

07-contracts-delta §D5 末尾の一般注記「キー追加は DDL 不要 (既存規約: contracts 追加 + バックフィル UPDATE)」との関係: バックフィル UPDATE は 0015 前例のとおり**既存行に必須フィールドを足す場合**の規約であり、新規行キーには適用されない。この限定は 07 §D5 側の注記にも v1.2 で明記済み (裁定記録 #20 で追認) — 両文書は矛盾しない。

### 2.5 media 参照 3 点セットの置換整合規則 (v1.2 — 0028 との二重置換関係は消滅)

**v1.2 整理 (07 §D5 v1.2 追随)**: 旧 v1.0/v1.1 の本節は「0028 (seal_media_id 追記、02-sales 所有) と 0035 (favicon_media_id 追記、本書所有) が同一オブジェクトを 2 回置換する」前提で、番号順適用と逆時系列適用の運用規則 (07 裁定記録 #21) を定めていた。**この前提は消滅した** — 07 §D5 v1.2 の角印 private 化 (seal_media_id 廃止 → seal_storage_path、0028 は branding-assets バケット作成に内容置換。02-sales §2.3.3 v1.2) により、media 参照 3 点セットを置換する migration は **0035 のみ**になった。旧規則 1〜4 (0028→0035 番号順・0035 先行時の 0028 スキップ・誤適用時の 0035 再適用・02-sales への SQL ヘッダ申し送り) は**全て撤回**する (裁定 #21 の 02-sales 反映も不要になった)。

存置する規則:

1. 0035 の適用は置換元 (0015 の policy/view・0017 の関数) の後であること (§2.2 ヘッダ)。0028 との順序制約はない
2. 参照集合の最終形の正は**番号最大の migration** (現時点 0035)。以後 media 参照を追加するモジュールは 0035 を包含した全文で置換する (0008→0013→0015→0035 の系譜を migration ヘッダに記録 — v1.2: 0028 は系譜から除外)
3. 事故検知 (置換漏れ・将来の再置換での favicon 条件消失) は受入 A1 の本番 SQL 実測 (media_admin_delete 定義に favicon_media_id 条件が存在すること) が担う (§13.2)

---

## 3. 値契約 (Zod)

### 3.1 settings 新キー (canonical: 07-contracts-delta §D5 — **本節は転記であり再定義ではない**)

```ts
// settings/contracts.ts — Phase 1 (M0 契約統合) で D5 全文が反映済みである前提。
// 以下は本書の実装対象 2 キーの転記 (乖離時は 07-contracts-delta §D5 → 統合後の
// module-contracts.md §4.2 が正)。

/** GA4 計測 (05-site-settings.md、裁定 J12)。measurement_id は秘匿でないため site_settings 可。
 *  null = 計測無効。タグ注入は (site)/layout.tsx のみ (admin/edit 除外) */
export const zAnalyticsSettings = z.object({
  ga4_measurement_id: z.string().regex(/^G-[A-Z0-9]{4,16}$/).nullable(),
}).strict();

/** ブランディング (favicon)。media 参照 3 点セット (media_admin_delete /
 *  media_reference_summary / ai_draft_cleanup_run) への追記は migration 0035 (05-site-settings.md) */
export const zBrandingSettings = z.object({
  favicon_media_id: zMediaId.nullable(), // null = 既定 favicon (public/favicon.ico — 05 §5.3 の移設後パス) にフォールバック
}).strict();
```

(転記注: 上記コメントのパス表記は 07 §D5 裁定記録 #19 で「既存 src/app/favicon.ico」→「public/favicon.ico — 05 §5.3 の移設後パス」に更新済み。本節は更新後の D5 と完全一致)

`SETTINGS_SCHEMAS` map の最終形 (11 キー — 既存 5 + D5 追加 6。v1.1 是正: telephony キー追加後の実数) も D5 が canonical。`zSeoDefaults` は**既存のまま変更しない** (`title_template` max60 + `%s` 必須 / `description` 50-160 字 / `og_media_id` = zMediaId **必須・非 nullable**)。

### 3.2 読み取りビュー型 (TS type — 外部入力ではないため Zod 化しない。契約書 §4.9 の規則)

```ts
// src/app/_lib/site-metadata.ts (site-public の app 層ヘルパ。新設)
import type { SettingsValue } from "@/modules/settings/contracts";

/** root layout (src/app/layout.tsx — 変更不可) のハードコード値と同値の fallback 定数。
 *  一致は tests/site-metadata-fallback-parity.test.ts が root layout の export を
 *  import して検証する (二重定義の乖離防止) */
export const SITE_META_FALLBACK = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app",
  titleDefault: "隈部塗装 | 3Dプリント表面処理の専門工房 — 大分県豊後高田市",
  titleTemplate: "%s | 隈部塗装",
  description:
    "3Dプリントを、量産品と見分けがつかない外観に。積層痕除去の研磨から自動車グレードの塗装仕上げまで、試作1点からブリッジ生産1,000個まで郵送で全国受託。隈部塗装(大分県豊後高田市)。",
  ogTitle: "隈部塗装 | 3Dプリント表面処理の専門工房",
  ogDescription:
    "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。郵送で全国からお受けします。",
  ogImage: { url: "/og-image.jpg", width: 1200, height: 630,
    alt: "隈部塗装 — 3Dプリント表面処理の専門工房" },
  siteName: "隈部塗装",
} as const;

/** generateMetadata / layout 本体が使う解決済みメタ (DB 値 + fallback を合成した後の形) */
export type ResolvedSiteMeta = {
  source: "db" | "fallback";              // seo_defaults 行の有無 (テスト・ログ用)
  titleDefault: string;
  titleTemplate: string;                  // seo_defaults.title_template ?? fallback
  description: string;                    // seo_defaults.description ?? fallback
  ogTitle: string;                        // 常に SITE_META_FALLBACK.ogTitle (DB 化しない —
                                          // seo_defaults に og 専用 title フィールドがないため。§5.2)
  ogDescription: string;                  // source="db" → seo_defaults.description /
                                          // source="fallback" → SITE_META_FALLBACK.ogDescription
                                          // (現行 root layout の短文を維持 — §5.2 の解決規則)
  ogImage:
    | { kind: "default"; url: string; width: number; height: number; alt: string }
    | { kind: "media"; url: string; alt: string };  // og_media_id の JPEG 決定論 URL。
      // width/height は宣言しない (media 行の公開文脈読み取りを増やさないための割り切り。
      // OGP 仕様上 og:image:width/height は optional — §5.4)
  gaId: string | null;                    // 注入判定済み (§5.1 resolveGaId 通過後)
  faviconHref: string | null;             // "/icon?v=xxxxxxxx" | null (未設定)
};
```

### 3.3 GET /icon の入力契約 (本書所有の新規 Zod)

```ts
// src/app/icon/route.ts 内 (route local。モジュール契約ではないため contracts.ts に置かない)
import { z } from "zod";

/** キャッシュバスト専用クエリ。値は応答内容に影響しない (検証は緩く、失敗時も無視して続行) */
export const zIconQuery = z.object({
  v: z.string().regex(/^[0-9a-f]{1,16}$/).optional(),
}).strict();
```

### 3.4 イベント payload

**該当なし。** 本モジュールはドメインイベントを発行しない (07-contracts-delta §D9 に settings 行はない)。設定変更の伝播は同期の `revalidateTag` のみ (§5.6)。

---

## 4. facade・Server Actions・API route・ジョブ仕様

### 4.1 SettingsFacade 拡張 — `getPublicValue` (契約外拡張)

公開側 (generateMetadata / (site) layout / GET /icon) は `cookies()` を呼べないため、既存 `settingsFacade.get` (cookie セッション client) が使えない。`createSupabasePublicClient` + `unstable_cache` の既存作法 (site-meta §1.4、pricingFacade / pageMediaFacade の facade 内 unstable_cache 前例) で公開読み取りメソッドを追加する。

```ts
// src/modules/settings/facade.ts — 契約外拡張 (契約書 §5 昇格候補。site-public →
// settings は read facade のみ許可済みの依存方向 — module-contracts §2)
/** unstable_cache のタグ。失効は書き込み側 Server Action の責務 (facade は revalidate しない規約) */
export const SITE_SETTINGS_CACHE_TAG = "site_settings";

export interface SettingsFacadePublic {
  /**
   * 公開文脈 (generateMetadata / unstable_cache / Route Handler) 用の読み取り。
   * - createSupabasePublicClient (anon・cookie 非依存)。RLS: 本書が読む 3 キー
   *   (seo_defaults/analytics/branding) は anon 可読の公開キー許可リスト内
   *   (07 §D5 v1.2 — M0 帯で全行 SELECT から許可リストへ置換済み)
   * - unstable_cache(keyParts: ["site_settings", key], { tags: [SITE_SETTINGS_CACHE_TAG] })
   * - 行なし = ok:true value:null (未設定は正常系 — E901 にしない。§2.4 の意味論)
   * - parse 失敗 / DB 障害 = err KMB-E901 (呼び出し側は null 扱いに degrade して公開表示を守る)
   */
  getPublicValue<K extends SettingsKey>(key: K): Promise<Result<SettingsValue<K> | null>>;
}
```

| 失敗系 | code | 呼び出し側の扱い |
|---|---|---|
| DB 接続障害 | KMB-E901 | fallback 値で描画継続 + console.error (公開ページを落とさない — pageMediaFacade.allDefaultFallback と同思想) |
| 値が SETTINGS_SCHEMAS と不一致 | KMB-E901 | 同上 |
| 行なし | (ok, value: null) | 「未設定 = 機能無効/既定値」として正常処理 |

### 4.2 MediaFacade 拡張 — `getPublicJpegUrl` (契約外拡張)

OGP 画像は og:image 互換性 (Facebook/LinkedIn 系スクレイパーが WebP 非対応) のため **JPEG レンディション** (`{mediaId}.jpg`) を使う。既存 `getPublicUrl` は WebP 決定論 URL を返す同期メソッドであり (media/facade.ts L148-151 実測)、同型の JPEG 版を追加する。

```ts
// src/modules/media/facade.ts — 契約外拡張 (契約書 §5 昇格候補)
/** 公開 "media" バケットの JPEG レンディション決定論 URL ({mediaId}.jpg)。
 *  getPublicUrl (webp) の同期・DB 非依存という性質を完全に踏襲する。
 *  実体の存在保証は呼び出し側の責務 (§4.3 updateSeoDefaultsAction が保存時に
 *  getJpegRenditionUrl で ensure する) */
getPublicJpegUrl(mediaId: string): Result<string>;   // 失敗: KMB-E901 (env 不正時のみ)
```

### 4.3 Server Actions (すべて先頭 `requireAdmin()` + Zod parse — 既存規約)

配置: `src/app/admin/settings/actions.ts` (既存ファイルへ追加・改修)。共通関数 `submitSettingsForm` は改修 1 点: 成功時に `revalidatePath("/admin/settings")` に加えて **`revalidateTag(SITE_SETTINGS_CACHE_TAG)` を全キー共通で呼ぶ** (公開側が読まないキーでも失効は無害。キー別分岐による漏れを構造的に防ぐ)。

| Action | 入力 (FormData → Zod) | 成功時 | 失敗 (code → recovery) |
|---|---|---|---|
| `updateAnalyticsSettingsAction` (新設) | `ga4_measurement_id` (空文字 → null。`zAnalyticsSettings`) | 保存 + revalidate | E101 → 「G-XXXXXXXXXX の形式で入力してください」 / E103 → 再読込案内 / E201/E202 → ログイン誘導 |
| `updateBrandingSettingsAction` (新設) | `favicon_media_id` (空文字 → null。`zBrandingSettings`) | 保存 + revalidate。**warning**: 選択 media が非正方形 (`width !== height`) または 128px 未満なら成功のまま警告文言を返す (`mediaFacade.getById` で寸法取得 — admin セッションで可) | 同上 |
| `updateSeoDefaultsAction` (既存・改修) | 既存どおり `zSeoDefaults` | 保存 + revalidate。追加 2 点: (1) **JPEG ensure** — `mediaFacade.getJpegRenditionUrl(og_media_id)` をベストエフォート実行 (失敗しても保存は成功。warning「OG 画像の JPEG 変換に失敗しました。再保存で再試行されます」+ console KMB-E902 相当ログ) (2) **寸法警告** — `getById` の width/height が 1200x630 (1.91:1 ±10%) から外れる場合 warning | 同上 |
| その他既存 Action | 変更なし (revalidateTag は共通関数側で付与される) | | |

戻り値型は既存 `SettingsFormState` を後方互換で拡張する:

```ts
// src/app/admin/settings/form-state.ts (既存ファイルへ追加)
export type SettingsFormState = {
  error: string | null;
  conflict: boolean;
  success: boolean;
  /** 保存は成功したが利用者に伝えるべき注意 (favicon 非正方形 / OG 寸法逸脱 / JPEG ensure 失敗)。
   *  既存 Action は常に undefined (後方互換) */
  warning?: string | null;
};
```

### 4.4 Route Handler — `GET /icon` (新設)

| 項目 | 仕様 |
|---|---|
| 配置 | `src/app/icon/route.ts` (フォルダ名 `icon` は通常ルート。App Router の `app/icon.*` ファイル規約とは衝突しない) |
| runtime | nodejs (sharp 使用。media ingest と同一基盤) |
| 認可 | anon GET (公開)。書き込みなし・秘匿情報なし |
| 入力 | クエリ `v` (§3.3 zIconQuery)。**応答内容に影響しない** (ブラウザ favicon キャッシュのバスト専用)。parse 失敗は無視して続行 |
| フロー | (1) `settingsFacade.getPublicValue("branding")` → (2) `favicon_media_id` が null (または読み取り degrade) → **307 redirect `/favicon.ico`** (public/ の既定ファイル、§5.3) → (3) 非 null → 公開 media バケットの WebP レンディション (`{id}.webp` — 常に存在する決定論パス) を fetch → (4) sharp で 192x192 cover (中央クロップ・アルファ保持) の **PNG** に変換 → 200 |
| 応答ヘッダ (200) | `Content-Type: image/png` / `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800` (URL は `?v=` で版付けされるため長め。§5.3。**s-maxage 必須** — v1.1: Vercel の Edge Network は Route Handler 応答のエッジキャッシュに s-maxage (または CDN-Cache-Control) を要求し、max-age のみではブラウザキャッシュ止まりになる) |
| 応答ヘッダ (307) | `Cache-Control: public, max-age=300, s-maxage=300` (未設定状態の短期キャッシュ — エッジにも乗せる) |
| 失敗系 | Storage fetch 失敗 / sharp 変換失敗 → **307 `/favicon.ico`** + console.error (KMB-E901 相当ログ)。**エラー応答 (4xx/5xx) は返さない** — favicon はサイト表示の一部であり degrade 最優先 |
| 同時実行・負荷 | s-maxage によりエッジキャッシュに乗るため実行頻度は低い (受入 A7 で 2 回目リクエストの `x-vercel-cache: HIT` を実測 — §13.2)。レート制限なし (静的資産相当) |

### 4.5 ジョブ (pg_cron → /api/jobs/*)

**該当なし。** 本モジュールに定期実行は存在しない。favicon 用 media の掃除は既存 `kmb-ai-draft-cleanup-worker` の管轄であり、0035 が cleanup 対象から favicon 参照 media を除外する (§2.2-3)。

### 4.6 facade 変更一覧 (00-overview / 07-contracts-delta との整合)

| facade | 変更 | 契約上の位置づけ |
|---|---|---|
| SettingsFacade | `getPublicValue` 追加 (§4.1) + `SITE_SETTINGS_CACHE_TAG` 定数 | **契約外拡張** (getWithMeta と同格)。§5 昇格は**裁定で却下** (07-contracts-delta v1.1「裁定記録」#14 — 呼び出し元は app 層のみで拡張規約どおり。跨モジュール利用が生じた時点で昇格) |
| MediaFacade | `getPublicJpegUrl` 追加 (§4.2) | 同上 |
| その他 (Crm/Sales/…) | 変更なし・呼び出しなし | 本モジュールは crm 系 facade に依存しない (依存: platform / settings / media のみ) |

---

## 5. 公開側配線 (本書の中核)

### 5.1 GA4 タグ注入 — `(site)/layout.tsx` 限定

**依存追加**: `@next/third-parties` (^15 系 — next と同系版)。`<GoogleAnalytics gaId="G-..." />` を `(site)/layout.tsx` の JSX 末尾 (SectionIndicator の後) に条件レンダーで置く。

```tsx
// src/app/(site)/layout.tsx (改修イメージ — 抜粋)
import { GoogleAnalytics } from "@next/third-parties/google";
import { resolveSiteMeta } from "@/app/_lib/site-metadata";

export default async function SiteLayout({ children }: ...) {
  const meta = await resolveSiteMeta();   // §5.2 と同一のキャッシュ済み解決 (settings 3 キー)
  // ... 既存の resolveAllTexts / JSON-LD / ヘッダ・フッタ ...
  return (
    <>
      {/* 既存 children ... */}
      {meta.gaId ? <GoogleAnalytics gaId={meta.gaId} /> : null}
    </>
  );
}
```

**注入判定は純関数** (単体テスト対象):

```ts
// src/app/_lib/site-metadata.ts
/** GA を注入すべきときのみ id を返す。
 *  - measurement_id 未設定 → null (機能無効)
 *  - `vercelEnv === "production"` のときのみ id を返し、それ以外 (Preview / dev /
 *    VERCEL_ENV 不存在) は常に null (v1.1: NODE_ENV フォールバック判定を廃止 —
 *    ローカル `next build && next start` は VERCEL_ENV なし + NODE_ENV=production に
 *    なり計測が混入するため、「Vercel 本番以外では計測しない」に倒す。
 *    本サイトのデプロイ先は Vercel のみ — §7.3 env) */
export function resolveGaId(
  ga4MeasurementId: string | null,
  vercelEnv: string | undefined,   // process.env.VERCEL_ENV
): string | null;
```

**除外の構造保証**: root layout (`src/app/layout.tsx`) は**変更しない** (J12)。GA コンポーネントは `(site)` route group のみに存在するため、`/admin/**` (admin layout)・`/edit/**` ((editor) group)・`/print/**` (sales が新設する独立セグメント) には構造的に載らない。E2E で admin ページの gtag 不在を検証する (§12)。

### 5.2 seo_defaults の公開側配線 — `(site)/layout.tsx` に `generateMetadata` 新設

root layout は不変のまま、`(site)/layout.tsx` に `generateMetadata()` を追加して公開ページのみ DB 駆動化する (site-meta §7-4 の裁定どおり「(site) 側に寄せる」)。

**Next.js metadata マージの意味論に対する設計上の注意 (本節の要)**: セグメント間のマージは**トップレベルフィールド単位の浅い置換**である。`(site)` layout が `title` を返せば root の `title` オブジェクト全体が置換され、`openGraph` を返せば `siteName`/`locale`/`type` 等も含めて置換される。したがって **`generateMetadata` は title / description / openGraph / twitter を常に全量返す** (DB 値 + `SITE_META_FALLBACK` の合成後の完全形)。`metadataBase` は返さない (root の値を継承)。

```ts
// src/app/(site)/layout.tsx (追加)
import type { Metadata } from "next";
import { buildSiteMetadata, resolveSiteMeta } from "@/app/_lib/site-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildSiteMetadata(await resolveSiteMeta());
}
```

```ts
// src/app/_lib/site-metadata.ts — 合成は純関数に隔離 (単体テスト対象)
/**
 * settings 3 キー (seo_defaults / analytics / branding) を settingsFacade.getPublicValue で
 * 読み (unstable_cache + tag "site_settings")、fallback と合成して ResolvedSiteMeta を返す。
 * どのキーの読み取りが失敗しても throw しない (fallback で埋める)。
 */
export async function resolveSiteMeta(): Promise<ResolvedSiteMeta>;

/** ResolvedSiteMeta → Metadata。返すフィールド:
 *  - title: { default: titleDefault, template: titleTemplate }
 *  - description
 *  - openGraph: { title: ogTitle (fallback 固定), description: ogDescription, type: "website",
 *      locale: "ja_JP", siteName, url: siteUrl, images: [ogImage] }
 *      (ogImage が kind:"media" のときは url のみ / kind:"default" は width/height/alt 付き)
 *  - twitter: { card: "summary_large_image", title: ogTitle, description: ogDescription,
 *      images: [ogImage.url] }
 *  - icons: faviconHref ? { icon: [{ url: faviconHref, type: "image/png" }] } : undefined
 *  metadataBase は含めない (root layout 継承)。純関数 (I/O なし) */
export function buildSiteMetadata(meta: ResolvedSiteMeta): Metadata;
```

**og/twitter 文言の解決規則 (v1.1 明文化)**: 現行 root layout は og:description / twitter.description に本文 description と**別の短文**、twitter.title / og:title に**短い OG タイトル**を持つ (src/app/layout.tsx L56-79 実測)。fallback 時 (`source: "fallback"`) に解決済み description (120 字長文) を og に流すと「現行と同一表示」(§0.4・§9 パターン 11) が破れるため、次のとおり確定する:

| フィールド | source="fallback" | source="db" |
|---|---|---|
| og:title / twitter:title | `SITE_META_FALLBACK.ogTitle` (現行短文) | 同左 (**DB 化しない** — seo_defaults に og 専用 title がない) |
| og:description / twitter:description | `SITE_META_FALLBACK.ogDescription` (現行短文) | `seo_defaults.description` (**意図した仕様**: 管理画面は description 1 本を一元管理し、og 専用文言フィールドは v1 で設けない。og が本文 description に寄るのは DB 設定の効果として明示) |

**JSON-LD の description 配線 (付帯)**: `(site)/layout.tsx` の `LOCAL_BUSINESS_JSON_LD` 定数を `buildLocalBusinessJsonLd(description: string)` 関数化し、`resolveSiteMeta().description` を渡す (同一キャッシュ読み — 追加コストなし)。他フィールド (社名・住所) はハードコード維持 (§0.5)。

**DB 値の効き方 (title_template の実効範囲の明文化)**: `(site)` 配下の既存 17 ページは全て `title.absolute` または `generateMetadata` 内 `title.absolute` を使っており (§5.7 実測)、template の実効対象は (a) トップページ (`/` — metadata 未定義 → default が効く)、(b) blog/notes/works の「見つかりません」フォールバック (plain string title)、(c) 将来追加されるページ、の 3 つ。description / OGP は metadata 未定義ページ (トップ) と将来ページに効く。**「全ページの title が即書き換わる」機能ではない**ことを admin UI の説明文にも明記する (§6.2)。

### 5.3 favicon の media 化 — ファイル規約からの移行

**現状**: `src/app/favicon.ico` (App Router ファイル規約、25,931 bytes) のみ。コード内の明示参照ゼロ (site-meta §2)。

**移行手順 (実装 Issue の作業単位)**:

1. `src/app/favicon.ico` → `public/favicon.ico` へ **git mv** (ファイル規約を撤去し、/favicon.ico は public/ 静的配信で存続)。
   - 根拠: ファイル規約が残ったまま `metadata.icons` を併用すると、file-based metadata が config-based を上書きする Next.js の優先規則により DB favicon のリンクが無効化される (または二重 link で挙動がブラウザ依存になる) — **決定論的でない組合せを構造的に排除する**。favicon.ico の実体バイトは不変 (D5 コメント「既存 favicon にフォールバック」の実質を維持)
2. `GET /icon` Route Handler 新設 (§4.4)
3. `(site)/layout.tsx` の generateMetadata が `branding.favicon_media_id` 設定時のみ `icons` を返す (§5.2)。href は `/icon?v={favicon_media_id 先頭 8 桁}` — media 差し替え = 新 uuid = 新 URL でブラウザの favicon キャッシュを確実にバストする
4. 未設定時は `icons` を返さない → link タグなし → ブラウザ既定の `/favicon.ico` リクエスト → public/ が応答 (admin/edit も同経路で従来どおり)

**画像規約**: MediaPicker でアップロードする favicon 素材は**正方形 PNG (512x512 推奨・最低 128x128)**。media パイプライン (sharp) は .ico を読めないため .ico アップロードは不可 (既存 ingest の挙動)。WebP レンディションはアルファを保持し、/icon の PNG 変換でも透過が維持される (結合テストで確認 — §12)。非正方形は /icon 側で中央 cover クロップ + 保存時 warning (§4.3)。

**拡張余地 (v1 スコープ外、§0.5)**: apple-touch-icon / manifest が必要になった場合は `/icon?size=180` のようにクエリでサイズ分岐し、`icons.apple` を追加するだけで済む構造にしてある (Route Handler 方式を選ぶ理由の一つ)。

### 5.4 OGP — og_media_id 配線と og-image.jpg 寸法是正

1. **既定 OG 画像の寸法是正**: `public/og-image.jpg` は実寸 1400x787 (sips 実測) で root layout の宣言 1200x630 と不整合。**画像側を直す** — sharp (または sips) で 1200x630 (1.91:1、OGP 標準) に中央クロップ・リサイズして再生成しコミットする。宣言側 (root layout) は変更不可制約 (J12) に触れず、かつ正しい値になる。受入基準 A8 (§13)
2. **og_media_id の配線**: seo_defaults 設定済みのとき、`(site)` generateMetadata の `openGraph.images` / `twitter.images` は `mediaFacade.getPublicJpegUrl(og_media_id)` の JPEG 決定論 URL (§4.2)。width/height/alt は宣言しない (OGP 仕様上 optional。media 行の公開文脈読み取りを増やさない割り切り — §3.2 コメント)。seo_defaults 未設定 (行なし) のときは既定 `/og-image.jpg` (1200x630 宣言付き)
3. **JPEG レンディションの存在保証**: 決定論 URL は実体の存在を保証しないため、`updateSeoDefaultsAction` が保存時に `getJpegRenditionUrl` で ensure する (§4.3)。受入テストで HEAD 200 を検証 (§13 A6)
4. ページ個別の OGP (works/blog/notes 詳細の cover 画像 = WebP URL) は**現状踏襲・変更なし** (§5.7。WebP の scraper 互換是正はページ別メタの器の議論と併せて将来課題 — openIssue)

### 5.5 robots.ts への /print disallow 追記

```ts
// src/app/robots.ts (改修 — 1 行)
disallow: ["/admin", "/edit", "/print"],
```

sales の印刷専用ルート `/print/documents/[id]` (署名トークン認証) の検索露出を防ぐ (00-overview §5.3 が本書 Issue に割当)。sitemap.ts は変更なし (公開ページの増減なし)。middleware matcher も変更なし (/print の認可はトークン方式 — 02-sales.md 所有)。

### 5.6 キャッシュ失効フロー (タグ設計)

```
admin 保存 (Server Action submitSettingsForm — 全キー共通)
  → settingsFacade.update (DB)
  → revalidatePath("/admin/settings") + revalidateTag("site_settings")   … app 層の責務
公開側 (site)/layout generateMetadata・本体 / GET /icon
  → settingsFacade.getPublicValue (unstable_cache tags: ["site_settings"])
  → タグ失効後の次リクエストで再生成 (SSG/ISR ページも同様 — page_text と同機構)
ブラウザ favicon キャッシュ
  → /icon?v={media_id 先頭8桁} の URL 版付けでバスト (§5.3)
外部からの強制失効 (障害時運用)
  → 既存 POST /api/revalidate (x-revalidate-secret) に tags: ["site_settings"] を渡す (実装変更不要)
```

タグ名 `site_settings` は既存タグ (works / posts:* / voices / prices / media / page_media / page_text) と衝突しない (grep 実測)。

### 5.7 ページ別メタの扱い — 既存一覧と変更点 (全数)

方針: **既存ページのメタ定義は 1 文字も変更しない**。変更は (site)/layout.tsx への generateMetadata 追加 (§5.2) と robots.ts (§5.5) のみ。

| ルート (src/app 配下) | 現状のメタ定義 | 本設計後の効き方 / 変更点 |
|---|---|---|
| layout.tsx (root) | 静的 `export const metadata` (title default+template / description / OG / twitter / metadataBase) | **変更なし**。admin・editor 系と、(site) generateMetadata が返さないフィールド (metadataBase) の正 |
| (site)/layout.tsx | メタ定義なし (JSON-LD のみ) | **generateMetadata 新設** (§5.2) + GA 注入 + JSON-LD description 配線 |
| (site)/page.tsx (トップ) | メタ定義なし | (site) layout の default title / DB description / DB OG 画像が効く (**DB 配線の主対象**) |
| (site)/{about, blog, colors, contact, materials, notes, privacy, process, service, shop, story, voices, works} /page.tsx (13 ページ) | 静的 `export const metadata` — 全て `title.absolute` + 個別 description (+多くは個別 openGraph.images 静的画像) | **変更なし**。title.absolute は template を迂回、個別 description/OG が layout 値を置換 (フィールド単位) — 現状挙動維持 |
| (site)/tokushoho/page.tsx | 静的 metadata + `robots: { index: false }` | **変更なし** (sitemap 除外も維持) |
| (site)/works/[slug]/page.tsx | `generateMetadata()` — DB (works) から title.absolute / description / OG=cover WebP URL | **変更なし**。「見つかりません」分岐の plain string title には (site) template が適用される (下記・既知事象) |
| (site)/blog/[slug]/page.tsx / notes/[slug]/page.tsx | 同型 `generateMetadata()` | **変更なし** (同上) |
| admin/layout.tsx | `title.template "%s | 隈部塗装 CMS"` + `robots: noindex` | **変更なし**。GA/favicon リンクは載らない (favicon はブラウザ既定 /favicon.ico) |
| (editor)/layout.tsx | `robots: noindex` | **変更なし** |
| robots.ts | disallow /admin, /edit | **/print 追記** (§5.5) |
| sitemap.ts | 静的 14 + 動的 3 種 | **変更なし** |

既知事象 (本書では変更しない・Issue 候補として記録): works/blog/notes の「見つかりません」フォールバックは plain string title (例 `"記事が見つかりません | 隈部塗装"`) のため親 template が適用され「… | 隈部塗装 | 隈部塗装」と二重サフィックスになる (現行 root template でも同様に発生している既存事象)。是正するなら `title.absolute` 化 1 行 ×3 ファイルだが、既存ページ無変更の原則を優先し本書スコープ外とする。

---

## 6. 管理画面 UI 仕様

### 6.1 画面構成 — /admin/settings (既存画面のタブ追加。新規ページ・nav 変更なし)

タブ順 (SettingsTabs — 既存 6 タブ + 新 2 タブ):

| タブ value | ラベル | 内容 | 本書 |
|---|---|---|---|
| company | 会社情報 | 既存 | 変更なし |
| hero | ヒーロー | 既存 | 変更なし |
| seo_defaults | SEO既定値 | 既存フォーム + **og_media_id を MediaPicker 化** | 改修 |
| **analytics** | **計測** | GA4 測定 ID フォーム | **新設** |
| **branding** | **ブランディング** | favicon MediaPicker フォーム | **新設** |
| ops_limits | 運用上限 | 既存 | 変更なし |
| notifications | 通知 | 既存 | 変更なし |
| ai | AI | 既存 (ai-providers) | 変更なし |

`settings/page.tsx` は `getWithMeta("analytics")` / `getWithMeta("branding")` を Promise.all に追加し、`SettingsTabsData` に 2 キーを足す。`force-dynamic` / PageHeader / Surface 構成は既存踏襲。

**メディア一覧の配線 (v1.1 明文化 — MediaPicker の必須 props)**: 共通 `MediaPicker` は `initialItems: PickerMediaItem[]` / `initialNextCursor` が必須 props であり (media-picker.tsx L38-39 実測)、既存利用箇所は親の Server Component ページが取得して子フォームへ渡す構成 (works/posts の new/[id] ページ → `listMediaForPicker()` (admin/_ui/media-picker-data.ts — 内部で `mediaFacade.list({cursor: null, limit: 100})`) + 選択済み id の補完 `ensureMediaItems()`)。settings も同型で配線する:

1. `settings/page.tsx` の Promise.all に `listMediaForPicker()` を追加
2. 現在値 (branding.favicon_media_id / seo_defaults.og_media_id) が一覧の limit 外でもプレビューできるよう `ensureMediaItems()` で補完
3. `SettingsTabs` の props に `mediaCatalog: PickerMediaItem[]` / `mediaNextCursor: string | null` を追加し、BrandingForm / SeoDefaultsForm が `<MediaPicker initialItems={mediaCatalog} initialNextCursor={mediaNextCursor} …>` に渡す (WorkForm L433-445 / PostForm と同型)

(invoice_issuer / business_hours / work_capacity のタブは各フェーズが同じ様式で追加する — 本書では作らない)

### 6.2 フォーム仕様

**計測タブ (AnalyticsForm — 新設)**

| 項目 | 仕様 |
|---|---|
| フィールド | `ga4_measurement_id`: `Input` 1 本 (placeholder "G-XXXXXXXXXX")。空欄 = 計測無効 |
| 検証 | `zAnalyticsSettings` (react-hook-form 不使用 — 単純フォームは `useActionState` 型。既存 settings フォームと同型) |
| 説明文 (PageHeader/FieldDescription) | 「Google アナリティクス (GA4) の測定 ID。設定すると公開サイトのみ計測されます (管理画面・編集画面は対象外)。空欄で保存すると計測を停止します。プレビュー環境では設定に関わらず計測されません」 |
| hidden | `expected_updated_at` (楽観排他 — 生文字列往復) |
| 保存 | `updateAnalyticsSettingsAction` → sonner toast (success/error)。E103 は conflict バナー (既存様式) |

**ブランディングタブ (BrandingForm — 新設)**

| 項目 | 仕様 |
|---|---|
| フィールド | `favicon_media_id`: 共通 `MediaPicker` (`src/app/admin/_ui/media-picker.tsx`) + 現在値のプレビュー (32px/64px の 2 サイズで実寸感を見せる) + 「既定に戻す」ボタン (null 保存) |
| 説明文 | 「サイトのタブに表示されるアイコン。正方形 PNG (512×512 推奨) をアップロードしてください。未設定のときは従来のアイコンが表示されます」 |
| 警告表示 | Action の `warning` (非正方形 / 128px 未満) を toast.warning + インライン `role="status"` で表示 (保存自体は成功) |
| hidden / 保存 | analytics と同型 (`updateBrandingSettingsAction`) |

**SEO既定値タブ (SeoDefaultsForm — 改修)**

| 項目 | 仕様 |
|---|---|
| og_media_id | 生 uuid テキスト入力 → **MediaPicker + プレビュー** に置換 (zSeoDefaults は非 nullable のため「クリア」は不可 — 選択必須のまま) |
| title_template / description | 既存フィールド維持。説明文に §5.2 の実効範囲を追記: 「テンプレートと説明文はトップページと今後追加されるページに効きます。各ページの個別タイトルは各コンテンツの編集画面が優先されます」 |
| 警告表示 | OG 寸法逸脱 / JPEG 変換失敗の `warning` を toast.warning 表示 |

### 6.3 キーボード操作 (E2E チェックリスト対象 — 全プロジェクト規約)

| キー | 動作 |
|---|---|
| Tab / Shift+Tab | タブリスト → フォームフィールド → 保存ボタンの論理順フォーカス (`TabsList` は roving tabindex — 既存 shadcn Tabs 準拠で ←→ でタブ切替) |
| ←/→ (タブリスト上) | タブ切替 (計測・ブランディング含む 8 タブ) |
| Cmd/Ctrl+S | フォーカス中フォームの保存 (既存 settings フォームの keydown フック様式を新 2 フォームにも実装) |
| Enter (MediaPicker 内) | フォーカス中の画像ボタンの選択トグル / 確定ボタンの実行 (native button 挙動) |
| Tab / Shift+Tab (MediaPicker グリッド) | 画像間のフォーカス移動 (**現行仕様** — v1.1 訂正: 既存 MediaPicker は native `<button>` の羅列で矢印キーによるグリッド内 roving は実装されていない (media-picker.tsx 実測 0 件)。矢印キーナビゲーション追加は既存全利用箇所 (works/posts/voices/visual) への回帰影響を伴う見積外改修のため本書スコープ外 — Issue 候補として記録) |
| Esc | MediaPicker ダイアログを閉じる (選択破棄 — radix Dialog 既定) |

### 6.4 使用部品

既存のみ: `Tabs/TabsList/TabsTrigger/TabsContent`・`Field/FieldLabel/FieldDescription/FieldError`・`Input`・`Button`・`MediaPicker` (_ui barrel)・sonner toast・`Surface`/`PageHeader`。**shadcn CLI での新規追加コンポーネントなし** (00-overview §2.4 の追加 5 種は crm/scheduling 系向けで本書は不要)。

### 6.5 契約不一致行 (破損行) の復旧経路 (v1.1 新設 — 全 settings キー共通の改修)

**現行実装の問題 (実測)**: 行が存在するが値が Zod 契約と不一致 (手動 SQL 事故・将来のスキーマ厳格化) の場合、`getWithMeta` は E901 を返し (facade.ts L78)、settings/page.tsx (L23-27) はこれを `{ value: null, updatedAt: null, isUnset: true }` に丸める。フォームの hidden `expected_updated_at` は空文字列になり (settings-forms.tsx L164 ほか)、`upsertSetting` (repository.ts L44-73) は既存行に対して `.eq("updated_at", "")` の UPDATE を試みるため**恒久的に conflict (KMB-E103)** — 「正しい値での再保存」では復旧できず、UI から脱出不能になる。

**改修 (本書スコープ — 全キー共通)**:

1. `getWithMeta` (契約外拡張 — §5 契約対象外のため 07 Δ 不要) を改修: 行ありで parse 失敗のとき err ではなく **`ok: true` + `{ value: null, updatedAt: <行の生 updated_at>, isUnset: false, corrupted: true }`** を返す (`SettingsMeta` に `corrupted?: boolean` を後方互換追加。行なし・DB 障害の挙動は不変)
2. settings/page.tsx: E901 丸めの分岐は DB 障害時のみに残り、破損行は corrupted メタがそのまま `SettingsTabsData` に載る
3. フォーム: `corrupted` のとき警告バナー「保存されている値が現在の形式と一致しません。保存すると入力した値で上書きされます」を表示。hidden `expected_updated_at` には**生の updated_at** が入るため、正しい値での再保存が成功する (楽観排他は維持 — 他者が先に直せば E103)

これにより §9 パターン 16 の「復旧は正しい値での再保存」が実際に成立する。公開側 (`getPublicValue`) は従来どおり E901 → fallback degrade (変更なし)。

## 7. 認可マトリクス (裁定 J1 — 4 列)

### 7.1 DB (RLS。site_settings / media とも既存ポリシーのまま — 本書での新設ポリシーは 0035 の media_admin_delete 置換のみ)

| テーブル | anon | admin | service | 将来 staff (方針) | 備考 |
|---|---|---|---|---|---|
| site_settings (settings 所有) | SELECT — **公開キー許可リスト** (07 §D5 v1.2 の M0 帯 RLS 置換後。本書 3 キー (seo_defaults/analytics/branding) はリスト内。追加分 (ga4_measurement_id / favicon_media_id) は非秘匿 — J12) | SELECT/INSERT/UPDATE (DELETE ポリシーなし — 既存) | ○ (bypass) | **R のみ** (サイト全体設定の変更は admin 限定。staff 導入時もポリシー追加不要) | 秘匿値 (認証情報・API キー等) は置かない (Vault 規約)。v1.1 時点の懸念「invoice_issuer.bank_account (口座番号) の anon 読取可否が未裁定」は **07 §D5 v1.2 の anon 可読キー許可リスト化 (BLOCKER 是正) で解消済み** — invoice_issuer / telephony / ops_limits / notifications / work_capacity は anon 不可読 (admin/service のみ)。本書の実装は許可リスト適用済み (M0 帯 = Phase 1 前提) の環境で進める |
| media (media 所有) | SELECT 全行 (既存) | INS/UPD + **DELETE は参照ゼロのみ (0035 で favicon/seal 参照が条件に加入)** | ○ | R/W (delete 条件は同一) | §2.2 |
| その他 (works 等) | — | — | — | — | 本書は触れない |

### 7.2 API エンドポイント / Server Actions

| エンドポイント | Method | 認可 | 主エラー |
|---|---|---|---|
| **/icon** (新設) | GET | anon (公開静的資産相当。書込なし・レート制限なし) | なし (失敗は 307 fallback — §4.4) |
| /favicon.ico | GET | anon (public/ 静的配信 — Next.js 管轄外) | — |
| updateAnalyticsSettingsAction / updateBrandingSettingsAction / updateSeoDefaultsAction | Server Action | 先頭 `requireAdmin()` + Zod parse (既存規約。works/actions.ts の歴史的例外は踏襲しない) | E201/E202/E101/E103 |
| /api/revalidate (既存) | POST | x-revalidate-secret (変更なし。tags に "site_settings" を渡せる — 実装変更不要) | — |

### 7.3 Storage / Vault / env

| 対象 | 内容 |
|---|---|
| Storage | 新設バケットなし。favicon/OG 素材は既存 `media` (公開レンディション) / `media-originals` の既存ポリシーのまま |
| Vault | 追加なし (GA4 測定 ID は非秘匿につき site_settings — J12。Vault 対象外) |
| env | **追加なし**。`NEXT_PUBLIC_SITE_URL` / `VERCEL_ENV` (Vercel 予約変数 — env.ts への追加不要、`process.env` 直読み + resolveGaId 純関数で吸収) を参照するのみ |

### 7.4 staff 拡張時の差分 (J1 の各書共通骨子)

本モジュールは admin 書込 + anon 読取のみで構成され、staff 導入時の変更は**ゼロ** (サイト設定の書込を staff に開放しない方針のため、ポリシー追加も requireRole 分岐も不要)。開放する判断になった場合のみ `site_settings_staff_update` ポリシー追加 + Server Action の `requireRole("staff")` 併設 (00-overview §5.5 の共通手順)。

---

## 8. ライフサイクルと状態意味論

### 8.1 設定キーのライフサイクル (analytics / branding / seo_defaults 共通)

```
(行なし = 既定)  ──初回保存──▶  (行あり: 値 v1)  ──保存──▶  (値 v2) ──…
      ▲                              │
      └──── branding/analytics は「null 保存」で機能無効へ戻る (行は残る)
            seo_defaults に「行削除で既定復帰」の UI は設けない (既存どおり DELETE ポリシーなし)
```

| 状態 | 意味論 | 公開側の挙動 |
|---|---|---|
| 行なし (`isUnset`) | 未設定。**正常系** (エラーではない) | fallback 定数 / favicon.ico / GA 無効 |
| `ga4_measurement_id: null` / `favicon_media_id: null` | 明示的に無効化 | 行なしと同一 (公開側は区別しない) |
| 値あり | 有効 | revalidateTag 後の次リクエストから反映 (**再デプロイ不要**) |
| 値が契約不一致 (手動 SQL 等の事故) | 公開側: getPublicValue が E901 → 呼び出し側 fallback。admin 側: getWithMeta が corrupted メタ (生 updated_at 付き) を返し、再保存で復旧可能 (§6.5) | 公開表示は壊れない + console.error |

不変条件:

- 公開側の描画は設定の取得可否に**依存しない** (fallback 完全定義 — §3.2 SITE_META_FALLBACK)
- 楽観排他: updated_at 生文字列比較 (KMB-E103)。設定は last-write-wins にしない (既存規約)
- `updated_by` は settingsFacade.update が session user を記録 (既存実装のまま)

### 8.2 favicon 用 media のライフサイクル (周辺リソース)

```
アップロード (MediaPicker) ─▶ media 行 + renditions ({id}.webp/{id}.jpg)
   ─▶ branding.favicon_media_id に設定 = 参照獲得
        │ (この間: media_admin_delete が削除を拒否 / reference_count ≥ 1 /
        │  ai_draft_cleanup_run の対象外 — 0035 §2.2)
   ─▶ 差し替え (新 media_id 保存) or null 保存 = 参照解放
        └─▶ 参照ゼロになった旧 media は admin が削除可 (E301 ガードは既存 media 仕様)
```

GA 計測のライフサイクル: 設定 → 失効反映後の次ページビューから計測開始。解除 → 同様に停止。過去データは GA 側に残る (本システムは保持しない)。

### 8.3 状態機械

**該当なし (理由明記)**: 本モジュールの永続状態は「キー別 JSONB 値」の単純な上書き更新のみで、遷移制約を持つ状態機械 (draft→published 等) は存在しない。ガードすべき遷移がないため遷移図・repository 二重検証は設けない。競合制御は楽観排他 (E103) が担う。

---

## 9. 全データパターン列挙 (設計・テストで必ずカバーする)

| # | パターン | 期待挙動 |
|---|---|---|
| 1 | analytics 行なし / null | GA タグ不在 ((site) 含む全ページ) |
| 2 | `G-ABC123XYZ0` (正常形式) | 本番 (site) のみ gtag ロード。admin/edit/print に不在 |
| 3 | 不正形式 (`UA-...`, 小文字, 空白混じり) | E101 でフィールドエラー (保存されない) |
| 4 | Vercel Preview / ローカル dev / ローカル本番ビルド (`next build && next start` — VERCEL_ENV なし) で measurement_id 設定済み | resolveGaId が null → 注入されない (VERCEL_ENV === "production" のみ注入 — §5.1) |
| 5 | branding 行なし / null | link タグなし → ブラウザが /favicon.ico を要求 → public/ の既定ファイル |
| 6 | favicon = 正方形 512x512 PNG (透過あり) | /icon が 192x192 PNG (透過保持) を返す。タブに反映 |
| 7 | favicon = 非正方形 / 128px 未満 | 保存は成功 + warning。/icon は中央 cover クロップ |
| 8 | favicon 参照中の media を削除試行 | media_admin_delete が拒否 (0 行削除) → facade E301「参照件数: n」 |
| 9 | favicon を null に戻した後に旧 media 削除 | 参照ゼロなら削除成功 |
| 10 | favicon media が ai-draft タグ付き (AI 生成画像を看板に採用) | 参照がある限り cleanup 対象外 (0035) |
| 11 | seo_defaults 行なし | fallback 定数で全メタ出力 (現行と同一表示) |
| 12 | seo_defaults 設定済み + og_media_id の JPEG レンディション未生成 (旧 media) | 保存時 ensure で生成。ensure 失敗時は warning + 決定論 URL は 404 になり得る → 再保存で再試行 (受入 A6 で HEAD 検証) |
| 13 | seo_defaults 設定済み + og 素材が 1.91:1 から大きく逸脱 | 保存成功 + 寸法 warning |
| 14 | title_template に `%s` なし / description 49 字・161 字 (境界) | E101 (既存 zSeoDefaults — 変更なしの確認) |
| 15 | DB 全面障害 (公開側読み取り不能) | getPublicValue が E901 → fallback 描画・GA 無効・favicon 既定。公開ページは 200 を返し続ける |
| 16 | 手動 SQL で value に不正キー混入 (.strict() 違反) | 公開側 fallback (E901 ログ)。admin タブは corrupted 警告バナー + 生 updated_at で再保存可能 (§6.5 — v1.1: 従来設計の「isUnset 丸め → 空文字 expected_updated_at → 恒久 E103」の脱出不能ループを是正) |
| 17 | 同時編集 (2 タブで同キー保存) | 後発が E103 conflict → 再読込案内 |
| 18 | /icon への直接アクセス (未設定時) / 古い ?v= URL | 307 → /favicon.ico / 現在値の PNG (v は内容に影響しない) |
| 19 | **seo_defaults 行あり (2026-07-08 シード由来 — 本番の実初期状態) でのリリース直後** (gap-prod-db §3) | source:"db" 経路。title_template/description はシード値 = fallback と同文のため実質無変化だが、**og:image はシード og_media_id (旧 1400x787 素材から ingest した media) の JPEG レンディション**になり、og:description は §5.2 の規則で DB description (長文) に切り替わる。§13.1 の移行手順 1b で寸法是正を完遂すること |

---

## 10. エラーコード

**新設コードなし** (00-overview §10: site-settings は「なし (E101/E103/E3xx 共用)」)。使用する既存コードと本モジュール文脈での recovery 文言:

| コード | 所有 | 本モジュールでの発生点 | 利用者向け recovery |
|---|---|---|---|
| KMB-E101 | content (入力検証・共用) | 測定 ID 形式不正 / title_template %s 欠落 / description 字数 | 「入力形式を確認してください」+ フィールドエラー表示 |
| KMB-E103 | content (楽観排他・共用) | 設定の同時編集衝突 | 「他の人がこの内容を更新しています。再読み込みしてください」 |
| KMB-E201 / E202 | platform | Server Action の未認証 / 非管理者 | ログイン画面へ誘導 |
| KMB-E301 | media | favicon/OG 参照中 media の削除試行 (メディアライブラリ側) | 「この画像はサイト設定で使用中です。設定を変更してから削除してください」 |
| KMB-E901 | platform (システム) | getPublicValue の DB 障害・契約不一致 / /icon の Storage 取得失敗 (ログのみ — 利用者にはフォールバック表示) | 管理者: ログ確認。公開側は自動 degrade |
| KMB-E902 | platform (通知 degrade) | JPEG ensure 失敗等のベストエフォート処理のログ | 再保存で再試行 |

新設が必要になった場合は 00-overview §3.3 (契約書) の改訂が先 (帯なしモジュールのため、必要時は E1xx 入力系の続番を content/settings 所有で協議 — 現設計では不要)。

---

## 11. 差分表示仕様

**該当なし (理由明記)**: 本モジュールの編集対象は単一 JSONB 設定値であり、版管理・派生・複数版の並記需要がない (帳票の版間差分 = 02-sales、価格プレビュー = 06-simulator の管轄 — 00-overview §8)。競合検出は楽観排他 (E103) が担い、「再読み込みして最新を確認」の運用で足りる。favicon / OG 画像の変更確認は §6.2 のプレビュー表示 (現在値の実寸プレビュー) が担う。

---

## 12. テスト戦略 (implementer + tester ペア・2 回連続 PASS を可能にする粒度)

### 12.1 レイヤ表

| レイヤ | テストファイル | 対象・分岐 |
|---|---|---|
| 単体 (Vitest) | `tests/settings-new-keys.test.ts` | D5 の 6 キーのうち 5 キー (analytics/branding/invoice_issuer/business_hours/work_capacity) の parse 正常/異常境界 (00-overview §9.2 割当。telephony キーの詳細境界は 04 `telephony-contracts.test.ts` 所掌 — 本テストは map 登録の存在確認のみ)。measurement_id regex 全分岐・favicon null/uuid・.strict() 拒否 |
| 単体 | `tests/site-metadata-resolver.test.ts` | `buildSiteMetadata` / `resolveGaId` 純関数: db/fallback/部分欠落 (seo のみ・branding のみ)・title/openGraph/twitter/icons の全量返却・**ogTitle/ogDescription の解決規則 (§5.2 の表 — fallback 時に現行短文が出ること)**・metadataBase 非含有・?v= 生成 |
| 単体 | `tests/site-metadata-fallback-parity.test.ts` | `SITE_META_FALLBACK` ↔ root layout `metadata` export の値一致 (title default/template・description・**openGraph.title/description・twitter.title/description**・OG 画像宣言 1200x630) — root layout 不変更制約下の二重定義ガード。**実行前提 (v1.1)**: root layout はモジュールスコープで next/font/google を呼ぶため素の Vitest では import 時に TypeError になる (実測)。vitest.config.ts に **next/font/google の alias スタブ** (`Noto_Sans_JP` 等の呼び出しに `{ variable: "", className: "" }` を返す callable 群 — 既存 server-only スタブと同様式 `tests/mocks/next-font-google.ts`) を追加すること |
| 単体 | `tests/icon-route.test.ts` | GET /icon の 3 分岐: 未設定 307 / 設定 200 image/png (小さな WebP fixture を sharp 実変換・透過保持・寸法 192) / fetch 失敗 307。Cache-Control ヘッダ |
| 契約 parity | `tests/contracts-ddl-parity.test.ts` (追記) | SETTINGS_SCHEMAS キー集合に analytics/branding を含む (キー名 ↔ 0035 の jsonb キー literal 'favicon_media_id' の一致検証を含める) |
| 結合 (DB, supabase start) | `tests/settings-media-refs.integration.test.ts` | 0035 の 3 点セット: (1) favicon 参照中 media の admin DELETE が 0 行 (2) media_reference_summary の reference_count 加算 (3) ai_draft_cleanup_run が favicon 参照 media を返さない (v1.2: 旧 (4)「seal_media_id キーでも同様 (0028 包含の検証)」は seal_media_id 廃止 — 07 §D5 v1.2 — により削除)。anon/admin/service 3 クライアント |
| 結合 (DB) | 既存 `tests/settings-repository.test.ts` (追記) | 楽観排他の既存挙動が新キーでも成立 (getWithMeta isUnset → 初回保存 → E103)。**追記 (v1.1)**: 破損行 (不正キー混入) で getWithMeta が corrupted メタ + 生 updated_at を返し、その updated_at での再保存が成功する (§6.5 の復旧経路) |
| 結合 (API) | `tests/settings-actions.test.ts` | 3 Action の requireAdmin ガード・revalidateTag("site_settings") 呼び出し (spy)・warning 分岐 (非正方形/寸法逸脱/ensure 失敗) |
| E2E (Playwright / Chrome MCP、本番前) | — | (site) トップで gtag スクリプト存在・/admin で不在・favicon link href=/icon?v= 反映・OGP メタタグ実測・robots.txt に /print・キーボード全項目 (§6.3: Tab/←→/Cmd+S/Esc/Enter — MediaPicker グリッドは Tab 移動が現行仕様。v1.1 訂正) |

### 12.2 Issue 分割と受入ゲート (2 回連続 PASS 単位)

| 子 Issue | 実装対象 | 必須テスト (受入基準に明記) |
|---|---|---|
| #4-1a 契約・migration | 0035 作成 + parity 追記 (+ 本番適用記録) | settings-media-refs (結合) / contracts-ddl-parity |
| #4-1b 公開側配線 | site-metadata.ts / (site)/layout (generateMetadata + GA + JSON-LD) / /icon / robots / favicon 移設 / og-image 再生成 / @next/third-parties 追加 | site-metadata-resolver / fallback-parity / icon-route / 既存テスト全件 regress ゼロ (2026-07-11 grep 実測 845+ 件 — v1.1 で「156+」の古い基準値を是正) |
| #4-1c 管理画面 | settings タブ 2 追加 + SEO タブ MediaPicker 化 + Actions | settings-new-keys / settings-actions / E2E キーボード |

カバレッジ: 契約 (Zod)・resolveGaId・buildSiteMetadata・/icon 分岐は 100%、その他 80% 目安。外部 API (GA) は CI で実呼び出しなし (スクリプトタグの存在確認のみ)。

---

## 13. 移行計画と受入基準

### 13.1 移行手順

**本番の実初期状態 (v1.1 — gap-prod-db §3 反映)**: 本番 site_settings には **seo_defaults 行が既に存在する** (2026-07-08 シード、scripts/seed-from-legacy.ts / seed-data/settings.ts)。シードの title_template / description は fallback と同文だが、**og_media_id は旧 1400x787 の public/og-image.jpg から ingest した media を指す**。したがって「行なし = 既定」でのリリースは本番では成立せず、公開トップは初日から source:"db" 経路になる (§9 パターン 19)。「データ移行なし (既存行の変更ゼロ)」は analytics/branding には正しいが seo_defaults には運用手順が要る:

1. migration 0035 を本番適用 (置換元 0015/0017 適用済み環境ならいつでも可 — §2.5 v1.2。旧「0028 より後・番号順 / 0035 先行後の 0028 適用スキップ」規則は 0028 の内容置換 (02-sales §2.3.3 v1.2) で前提消滅)

   1b. **本番 seo_defaults の og 素材是正 (v1.1 追加)**: 本番の seo_defaults 実値を確認し、(a) 1200x630 (1.91:1) の素材を新規アップロードして og_media_id を差し替え再保存 (JPEG ensure 込み — §4.3)、または (b) 現行シード media のレンディションを 1200x630 で再生成する。手順 3 (public ファイルの再生成) だけでは**本番の og:image は直らない** (source:"db" 経路のため)。受入 A8 で実配信を実測
2. `git mv src/app/favicon.ico public/favicon.ico` を含む実装 PR (§5.3)。ロールバックは revert のみで完結 (DB 状態に依存しない)
3. `public/og-image.jpg` の 1200x630 再生成をコミット (旧ファイルは git 履歴で保全 — fallback 経路と admin 未設定環境向け)
4. 依存追加 `@next/third-parties` (ローカル `npm ci` + 型チェックを EAS/デプロイ前に実施 — 全プロジェクト規約)
5. リリース即日の表示変化の周知 (v1.1): og:description が root layout の短文 → DB description (長文) に切り替わる (§5.2 の規則・§9 パターン 19)。文言を旧短文に寄せたい場合は管理画面の description 編集で対応

### 13.2 受入基準

| # | 基準 | 検証方法 |
|---|---|---|
| A1 | 0035 適用後、favicon 参照中 media の削除が anon/admin とも拒否され、参照解放後に admin で削除できる。**本番の media_admin_delete 定義に favicon_media_id 条件が存在する** (置換漏れ・将来の再置換での条件消失の検知 — §2.5-3 v1.2) | 結合テスト + 本番 SQL 実測 (pg_policies の定義文字列検査) |
| A2 | media_reference_summary が favicon 参照をカウントし、メディアライブラリの参照数表示に現れる (v1.2: seal は media 参照ではなくなったため対象外) | 結合テスト + 実機 |
| A3 | ai_draft_cleanup_run が favicon 参照中の ai-draft media を削除しない | 結合テスト |
| A4 | `vitest run` の既存テストが 1 件も regress しない (2026-07-11 grep 実測 845+ 件) + 既存 settings 5 キーの保存動作無変更 | vitest run + 実機 |
| A5 | GA: 測定 ID 設定後、本番 (site) ページで gtag が読み込まれ、/admin・/edit で読み込まれない。ID 削除で停止 | Chrome MCP 実機 (network タブ) |
| A6 | seo_defaults 保存 → 公開トップの description / og:image が反映され、og:image URL への HEAD が 200 | E2E + curl |
| A7 | favicon 設定 → (site) タブアイコンが差し替わる (再デプロイなし)。未設定時・/icon 障害時は既定アイコン。**/icon への 2 回目リクエストが `x-vercel-cache: HIT`** (エッジキャッシュ実効 — §4.4 の s-maxage) | Chrome MCP 実機 + curl -I ×2 |
| A8 | `public/og-image.jpg` の実寸 = 1200x630 (宣言と一致)。**加えて本番トップの og:image が実際に 1200x630 (1.91:1) の素材で配信される** (本番は source:"db" 経路のため public ファイル検査だけでは不十分 — §13.1-1b の是正後に実測。v1.1) | sips 実測 (CI スクリプト可) + 本番トップの og:image URL の実画像取得・寸法実測 |
| A9 | robots.txt に /print disallow が出力される | curl /robots.txt |

---

## 14. 規模見積り

| 対象 | 新規/改修 | 概算行数 (実装) | テスト |
|---|---|---|---|
| migration 0035 | 新規 | 〜140 | (結合で検証) |
| settings/facade.ts (getPublicValue + tag 定数) | 改修 | 〜60 | 〜60 |
| media/facade.ts (getPublicJpegUrl) | 改修 | 〜15 | (resolver テスト内) |
| src/app/_lib/site-metadata.ts | 新規 | 〜150 | 〜180 |
| (site)/layout.tsx (generateMetadata + GA + JSON-LD) | 改修 | 〜70 | (resolver/E2E) |
| src/app/icon/route.ts | 新規 | 〜130 | 〜130 |
| robots.ts | 改修 | 1 | (E2E) |
| admin settings (page/actions/forms/form-state) | 改修 | 〜330 | 〜200 |
| settings-new-keys / parity 追記 / 結合 | — | — | 〜330 |
| アセット (favicon 移設 / og-image 再生成) | 資産 | — | — |
| **合計** | | **〜900** | **〜900** |

新規テーブル 0 / 新規画面 0 (既存タブ +2) / 新規ルート 1 (/icon) / migration 1 本 (0035)。

**Phase 4 合算見積りの不整合 (v1.1 是正)**: 本書分は 〜1,800 (実装 〜900 + テスト 〜900)。06-simulator §17 の 〜1,700 と合算すると **〜3,500** となり、00-overview §13 の Phase 4 行 (settings+simulator 〜2,200) を大幅に超過する — v1.0 の「整合」宣言は撤回する。**00-overview §13 の Phase 4 見積りを 〜3,500 へ改訂すること (00-overview への申し送り。06-simulator §17 の「整合」宣言も同時是正が必要)**。→ **消し込み (v1.2)**: 00-overview v1.2 (§13 = 〜3,500・合計 〜34,300) と 06-simulator v1.2 (§17 整合宣言の撤回) で反映済み。

ランニングコスト増分: なし (GA4 無料枠・追加 API 呼び出しなし)。

---

## 15. リスクと要確認事項

| # | リスク | 影響 | 対応 |
|---|---|---|---|
| R1 | Next.js metadata のセグメント間マージ (トップレベル置換) の踏み外し — openGraph の siteName 等が欠落する回帰 | OGP 表示劣化 | generateMetadata は常に全量返却 (§5.2)。buildSiteMetadata 純関数の単体テストでフィールド全数を検証 |
| R2 | favicon ファイル規約と metadata.icons の優先順位が非決定 | DB favicon が効かない | ファイル規約を撤去し public/ + /icon に一本化 (§5.3)。E2E A7 で実機確認 |
| R3 | ブラウザの favicon キャッシュが更新に追従しない | 差し替え反映遅延 | `?v={media_id 先頭8桁}` の URL 版付け (§5.3) |
| R4 | sharp の WebP→PNG 変換でアルファ喪失・色ズレ | 看板品質 | icon-route 単体テストで透過 fixture を実変換検証 (§12.1) |
| R5 | Preview/dev 環境の計測混入 | 分析データ汚染 | resolveGaId の VERCEL_ENV ガード (§5.1)。データパターン 4 |
| R6 | og_media_id の JPEG レンディション未生成で og:image 404 | シェア時サムネイル欠落 | 保存時 ensure + 受入 A6 の HEAD 検証。失敗時 warning で利用者に再保存を促す |
| R7 | ~~0028 (sales) との同一オブジェクト二重置換の順序事故~~ **解消 (v1.2)** — 07 §D5 v1.2 の角印 private 化で 0028 が 3 点セットを触らなくなり、二重置換関係が消滅 | (残余) 将来の 3 点セット再置換での favicon 条件消失 | 系譜規則 (§2.5-2) + A1 の pg_policies 実測 |
| R8 | site_settings に将来秘匿値を置いてしまう | 情報漏えい | anon SELECT は 07 §D5 v1.2 で公開キー許可リストに置換済み (M0 帯 — 「全行 SELECT」の前提は解消)。本書は非秘匿値のみ追加 (J12)。§7.1 備考に「秘匿値は Vault」を再掲 |

堀さん確認事項 (★):

- GA4 プロパティの作成と測定 ID の払い出しは堀さん/熊部さん側の作業 (Google アカウント)
- **GA 有効化と同時に /privacy (src/app/(site)/privacy/page.tsx — 実在) へ Google アナリティクス利用の記載 (データ収集・Cookie 利用・オプトアウト手段) を追加する** (Google アナリティクス利用規約がプライバシーポリシーでの開示を義務付けているため。v1.1 追加)。静的ページの文言更新であり、測定 ID の設定作業とセットの運用タスクとして扱う
- 改正電気通信事業法の外部送信規律は、本サイトが自社広報サイト (利用者への情報伝達を目的とし、対利用者役務の提供サイトに非該当) のため適用外と判断する (v1.1 判断メモ)。異議があれば設計変更前に相談
- Cookie 同意バナー不要の判断 (§0.5) に異議があれば設計変更前に相談

---

## 16. staff 拡張差分 (裁定 J1 — 拡張章)

§7.4 のとおり本モジュールの staff 差分は**ゼロ** (サイト設定は admin 専権のまま)。staff にサイト設定の閲覧を許す場合も、site_settings は authenticated + RLS SELECT が既に全行許可 (anon 含む) のため追加作業なし。書込開放時のみ `site_settings_staff_update` ポリシー + `requireRole('staff')` 併設 (00-overview §5.5)。

---

## 17. 設計チェックリスト適合表 (必須 10 章)

| チェック項目 | 本書での対応 |
|---|---|
| ① 認可マトリクス (anon/admin/service/将来staff) | §7 (DB/API/Storage/env + staff 差分は §16) |
| ② テスト戦略表 (単体+結合、ペア 2 連続 PASS 粒度) | §12 (レイヤ表 + Issue×テスト対応 §12.2) |
| ③ エラーコード表 | §10 (新設なし — 共用コード + recovery 文言。00-overview §10 の割当どおり) |
| ④ ライフサイクル | §8.1〜8.2 (設定キー / favicon media / GA 計測) |
| ⑤ 全データパターン列挙 | §9 (19 パターン — v1.1 で本番初期状態 #19 を追加) |
| ⑥ 印刷出力仕様 | §0.6 (**該当なし + 理由**。接点 = robots /print disallow のみ) |
| ⑦ 移行受入基準 | §13 (手順 + A1〜A9 検証方法付き) |
| ⑧ 規模見積り | §14 |
| ⑨ 状態意味論 | §8.3 (**状態機械は該当なし + 理由**。意味論は §8.1 の表) |
| ⑩ 差分表示仕様 | §11 (**該当なし + 理由**) |
| モジュール契約 (全プロジェクト規約) | §3.1 (D5 転記・再定義禁止)・§4.6 (facade 拡張の位置づけ)。module-contracts.md は直接編集しない (J10) |
| 値契約 (Zod canonical) | §3 (D5 転記 + 本書所有分) + §2.3 (JSONB↔型契約対応表) |
| 非機能要件 | §4.4 (キャッシュ/負荷)・§5.6 (失効フロー)・§14 (コスト)・§15 (リスク) |

### 更新履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v1.1 | 2026-07-11 | レビュー指摘 16 件の反映。(1) §2.2/§2.5-4/§13.1-1/A1: 0028↔0035 逆時系列適用の運用規則 — 0035 適用済み環境での 0028 スキップ・誤適用時の 0035 再適用・本番 pg_policies 実測による事故検知 (02-sales への申し送り = 07 裁定記録 #21) (2) §13.1/§9 #19/A8: 本番 seo_defaults 行の実在 (gap-prod-db §3 — 入力資料に追加) への移行手順 1b と og:image 実配信の実測化 (3) §3.2/§5.2/§12.1: og/twitter 文言の fallback 解決規則の明文化 (ogDescription/ogTitle 追加・parity テスト対象拡大) (4) §12.1: fallback-parity テストの next/font/google alias スタブ前提を明記 (5) §6.3/§12.1 E2E: MediaPicker 矢印キーの虚偽記載を Tab 移動 (現行仕様) に訂正 (6) §6.1: MediaPicker データ配線 (listMediaForPicker/ensureMediaItems/mediaCatalog props) の明文化 (7) §6.5 新設 + §8.1/§9 #16/§12.1: 契約不一致行の復旧経路 (corrupted メタ + 生 updated_at 再保存) (8) §4.4/A7: /icon 応答に s-maxage 追加 + x-vercel-cache HIT 実測 (9) §5.1/§9 #4: resolveGaId を VERCEL_ENV==="production" 限定に変更 (NODE_ENV フォールバック廃止 — ローカル本番ビルドの計測混入防止) (10) §3.1: D5 転記の完全一致復元 (favicon フォールバックパスは 07 裁定記録 #19 で canonical 側を更新) (11) §2.4: 07 §D5 バックフィル注記との整合 (07 裁定記録 #20) (12) §7.1/§4.1/R8: 07 §D5 v1.2 の anon 可読キー許可リストを反映 (bank_account 懸念の解消を追記) (13) §14: Phase 4 合算見積り不整合 (05+06=〜3,500 vs 00 §13 の 2,200) の明示と 00-overview への改訂申し送り (14) §15 ★: GA 有効化時の /privacy 開示義務・外部送信規律適用外の判断メモ (15) §12.2/A4: テスト件数基準を実測値 (845+) に是正 (16) §17: データパターン数 19 に更新 |
| v1.2 | 2026-07-11 | **07 §D5 v1.2 (角印 private 化) 追随の統合整理** (触れた章: §1 依存/§2.2/§2.5/§12.1 結合/§13.1-1/A1/A2/R7)。02-sales v1.2 が migration 0028 を「seal_media_id の 3 点セット置換」から「branding-assets private バケット作成」に内容置換したことに伴い: ①§2.2 の 3 点セット SQL から seal_media_id 条件を削除 (favicon_media_id のみに)・0028 関係のヘッダ注記を「関係なし」に書き換え ②§2.5 の 0028↔0035 同一オブジェクト二重置換規則 + 逆時系列適用運用 (07 裁定記録 #21) を**前提消滅により撤回** (系譜は 0008→0013→0015→0035 に更新。A1 の pg_policies 実測は置換漏れ検知として存置) ③結合テスト (4) seal 検証の削除・A2 から seal 除外・R7 を解消済み化・§13.1-1 の適用順制約を撤去 |
| v1.0 | 2026-07-11 | 初版。裁定 J12 準拠 — analytics/branding キー (Zod canonical = 07-contracts-delta §D5 転記)・GA4 (site) 限定注入・seo_defaults 公開側配線 (generateMetadata 全量返却方式)・favicon media 化 (/icon Route Handler + ファイル規約撤去 + migration 0035 の media 参照 3 点セット)・og-image 1200x630 是正・robots /print disallow |
