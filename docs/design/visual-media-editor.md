# ビジュアル画像エディタ 設計書

- 版: v1.4 (Codex v1.3 レビューの BLOCKER 1 / MAJOR 3 / MINOR 4 を解消。resolver 契約 Record 化・/edit fresh fetch・cover CAS)
- 作成日: 2026-07-08 (v1.0) → 2026-07-09 (v1.1 → v1.2 → v1.3 → v1.4)
- 作成: メインセッション直接執筆 (v1.0-1.2 Opus 4.8 / v1.3-1.4 Fable 5)
- 対象: DaisukeHori/kumabe-tosou (`main`)
- 親設計: [cms-ai-pipeline.md](./cms-ai-pipeline.md) / 契約: [module-contracts.md](../module-contracts.md)

## 0. 目的とスコープ

### 0.1 目的
公開ページの写真を「アドレス/UUID を貼る」のではなく、**実物ページの縮小版(iframe)を管理画面に表示し、その中の写真を直接クリック → メニューから差し替え・alt 編集・既定に戻す**ことができるビジュアル編集を、**全公開ページ**に対して提供する。

### 0.2 前提 (棚卸し 2026-07-08 の結果)
- 公開ページの `<Image>` は 55 箇所。うち **固定パス 40 箇所**(`<Image src="/img/xxx.jpg">`、静的 import は 0)、残りは既に DB 管理 (works.cover / work_images / voices.photo / posts.cover)。
- `site_settings.hero.media_id` はスキーマ + admin フォームがあるが**公開トップが未接続**(`/hero.jpg` 直書き)。
- 装飾は CSS グラデーション/SVG/地図 iframe — **写真ではないためスコープ外**。
- `next/image` は全て文字列 src。`next.config.ts` は Supabase Storage を remotePatterns 許可済み。`home.hero` のみ `priority`。aspect/sizes は `PhotoFigure`/`MediaCover` 側で固定。

### 0.3 スコープ外
- 画像そのもののトリミング/フィルタ等の編集(「編集」= 差し替え + alt + 既定復帰に限定)。将来 Phase。
- テキスト/レイアウトのビジュアル編集(画像のみ)。
- OGP 画像の自動同期(独立スロットとして扱い、当面は手動)。

---

## 1. 編集対象の 2 種別 (最重要の設計判断)

クリック可能な画像は 2 系統あり、**data 属性で判別**して別々の保存経路に流す。二重管理を避けるため既存 DB 画像は既存フィールドをそのまま slot として扱う。

| 種別 | 対象 | 識別 data 属性 | 保存先 |
|---|---|---|---|
| **ページスロット** | 固定 40 枚 (home.hero 含む) + 新規 4 枠 (story.portrait / shop.product.1-3) = **計 44** | `data-editable-slot="home.hero"` | `page_media` テーブル (§2) |
| **コンテンツ画像 (単一)** | works.cover / voices.photo / posts.cover | `data-editable-content="{kind}:{id}:cover"` | 既存コンテンツテーブルの media FK |
| **コンテンツ画像 (join 行 = ギャラリー)** | work_images (施工事例詳細のギャラリー) | `data-editable-work-image="{work_id}:{media_id}"` | work_images 行の置換 (delete + insert) |

- ページスロット: 装飾/ヒーロー等、コンテンツに紐付かない「ページの見た目」の写真。
- コンテンツ画像: 施工事例・声・記事の実データ写真。ビジュアルエディタからも差し替え可能だが、保存は既存の ContentFacade 経由(works.cover_media_id 等)。
- work_images (BLOCKER-2 対応): join 行の identity は `(work_id, media_id)` なので、data 属性に**両方**を持たせ、置換保存は「該当 work_id のギャラリー内の {旧 media_id} を {新 media_id} に置き換え、sort_order を維持」で行う (§6 setWorkImage)。
- **hero (BLOCKER-1 対応)**: `home.hero` を page_media スロットに**一本化**し、`site_settings.hero` から `media_id` を削除する (migration で除去、Zod からも削除)。hero の見出し/CTA テキストは従来どおり `site_settings.hero`(テキストのみになる)。二重管理を消し「hero 画像 = page_media が唯一の正」に。既存 admin 設定フォームの hero タブは「見出し・CTA テキスト編集のみ」に縮退。

---

## 2. データモデル (canonical DDL)

```sql
-- ページの装飾/ヒーロー画像スロット。slot_key はコード側の registry (§3) が正。
create table page_media (
  slot_key text primary key,          -- 'home.hero' | 'home.craft.1' 等 (§3 registry と 1:1)
  media_id uuid references media(id),  -- null = 既定画像 (default_src) を使用
  alt_override text,                   -- null = media.alt or registry.altDefault
  updated_at timestamptz not null default now()
);
-- default_src / page / section_label / aspect / sort_order 等の静的メタは DB に持たず
-- コード側の SLOT_REGISTRY (§3) が単一ソース。page_media は「差し替えられた分」だけを保持する。
--
-- BLOCKER-v1.3 対応 (updated_by 廃止):
--   v1.2 は「anon には view 経由でだけアクセスさせ base table へは direct grant しない」としたが、
--   security_invoker view は呼び出しロールが underlying table の SELECT 権限も要求するため矛盾していた。
--   さらに Supabase は default privileges で public スキーマの全テーブルに anon/authenticated へ
--   grant を発行するため、「grant しない」は現実の環境と不一致。
--   v1.3 の割り切り: page_media は全列が公開メタデータ (slot_key はレンダリング済み HTML から自明、
--   media_id は公開 URL に含まれる、alt は HTML に出る)。唯一の秘匿候補だった updated_by 列は
--   単一 admin サイトで監査価値が低いため**列ごと廃止**し、露出しうる秘匿情報をゼロにする。
--   anon は base table を直接 SELECT してもよい (RLS ポリシーで明示許可)。

create trigger handle_updated_at before update on page_media
  for each row execute procedure extensions.moddatetime (updated_at);

alter table page_media enable row level security;

create policy page_media_anon_select on page_media for select using (true);
create policy page_media_admin_insert on page_media for insert with check (public.is_admin());
create policy page_media_admin_update on page_media for update using (public.is_admin()) with check (public.is_admin());
create policy page_media_admin_delete on page_media for delete using (public.is_admin());

-- MINOR-v1.4: Supabase の default privileges に依存せず grant を明記 (移植性)
grant select on page_media to anon, authenticated;
grant insert, update, delete on page_media to authenticated;

-- resolver が 1 クエリで alt を得るための join view (利便目的であり、アクセス制御目的ではない)。
-- media は既存ポリシー media_anon_select (0002: using true) により anon SELECT 可のため、
-- security_invoker=true でも anon から全行読める。grant は 0008 の media_reference_summary の前例踏襲。
create or replace view public.page_media_resolved
with (security_invoker = true) as
select
  pm.slot_key,
  pm.media_id,
  pm.alt_override,
  m.alt as media_alt
from page_media pm
left join media m on m.id = pm.media_id;

grant select on public.page_media_resolved to anon, authenticated;

-- BLOCKER-1 対応: site_settings の hero.media_id を廃止 (テキストのみに縮退)。
-- 既存行があれば value から media_id を除去。
update site_settings
   set value = value - 'media_id'
 where key = 'hero'
   and value ? 'media_id';
```

`page_media` は **差分のみ保持**(upsert)。「既定に戻す」= その行を削除 or media_id=null。DDL 追加は **1 テーブル (page_media) + 1 view (page_media_resolved) のみ**。migration 連番は **0013**(現行 migration は 0001〜0012 の 12 本。※HANDOFF.md v1 の「0013 適用済み」は誤記で、0012 が最新)。RPC は使わない (v1.1 の rpc_get_page_media_all は撤回)。

BLOCKER-3 対応の DB 変更はなし (空スロット可視化は admin UI 側で吸収、§5.5)。
MAJOR-8 対応で **RLS の `media_admin_delete` ポリシー (0002)** と **`media_reference_summary` view (0008)** の両方を 0013 で置き換える (page_media 参照を加算)。

### 2.1 全データパターン
| パターン | 挙動 |
|---|---|
| slot 行なし | registry の default_src を表示 (移行前・既定状態) |
| media_id 設定 | media レンディション webp URL を表示 |
| media_id=null (行あり) | default_src にフォールバック (= 既定に戻す) |
| 参照 media 削除 | media_admin_delete の参照ゼロ判定に page_media も含める (§5.4 で E301 拡張) |
| 未来スロット (story.portrait 等) の default なし | 「NO IMAGE / 画像を設定」プレースホルダ表示 (MediaCover 準拠) |

### 2.2 alt 決定順 (MAJOR-1 対応)
`SlotImage` の alt は次の優先順で決定する。resolver がこれを事前計算して `{alt}` を返す。

1. `page_media.alt_override` (非 null)
2. **`media.alt`** (差し替え後は新画像の alt が既定になる、旧画像に引きずられない)
3. `registry.altDefault` (page_media 行がないか alt_override も null、かつ media_id もないとき)

コンテンツ画像 (works.cover 等) の alt は `media.alt` を唯一の正とする (per-use override は導入しない — 複雑化を避ける)。

### 2.3 メディア URL 規約の統一 — V0 前提補修 (MAJOR-v1.3 / MINOR-v1.4 で事実訂正)

**本番実測 (2026-07-09)**: v1.3 時点の記述「seed 由来のみ storage_path 直で動く」は誤りだった。実態:

- `scripts/seed-from-legacy.ts` は**既に** `{id}.webp` / `{id}.jpg` を生成している (seed-from-legacy.ts:95-108。`src/modules/media/facade.ts` の「seed は規約に従っていない」コメントが古い)。
- 本番 Storage への HTTP 実測: `.../media/seed/works/car-detail.jpg` (storage_path 直、現行 `toPublicMediaRef()` が組み立てる URL) = **400**。`.../media/{id}.webp` = **200**。

つまり **公開サイトの works/voices/posts の DB 画像は現在表示されていない (実バグ、hotfix 対象)**。media バケットに storage_path 名のオブジェクトは存在せず、`{id}.webp` は全 media に存在する。統一先は (B) 決定論レンディション URL 一択:

1. **hotfix**: `toPublicMediaRef()` (`src/app/_lib/media.ts`) の URL 生成を media facade の決定論 URL (`{id}.webp`) に置換。`_lib` → facade の import はモジュール境界上 OK。facade.ts の古いコメント (「seed が規約に従っていない」「storage_path 配信の暫定実装」) を削除。
2. **検証スクリプト** `scripts/verify-media-renditions.ts`(冪等): 全 media 行を走査し `{id}.webp` の HTTP ステータスを確認。欠損があれば media-originals の原本から `processImageForRenditions()` で再生成してアップロード (実測では欠損ゼロの見込みだが、全量を機械的に確定させる)。
3. **受入基準**: (a) 検証スクリプトで全 media 行の `{id}.webp` が 200、(b) 公開 works/voices/notes/blog の全画像が実ブラウザで表示される、(c) `npm test` 既存 156 件 PASS。
4. 以降、resolver (§4.1) も MediaPicker も「全 media が `{id}.webp` を持つ」を不変条件として扱ってよい。MediaPicker 側のフィルタは不要。

V0 は公開サイトの実バグ修正なので、visual editor 本体の実装 GO とは独立に**先行実施してよい**。

---

## 3. スロットレジストリ (コード canonical)

`src/modules/page-media/registry.ts` に全スロットを定義。**これが slot_key・default_src・page・label・aspect の単一ソース**。migration seed も admin エディタの一覧も本 registry から生成 (手書き重複禁止)。

```ts
export type PageSlot = {
  key: string;            // 'home.hero'
  page: string;           // 'home' (公開ルートは routeFor(page))
  route: string;          // '/' | '/about' 等 (iframe で開く実ルート)
  label: string;          // 管理画面表示用 'トップ / ヒーロー'
  defaultSrc: string | null; // '/hero.jpg' | null(未来スロット)
  altDefault: string;
  aspect: "hero" | "card32" | "card34" | "square" | "band219";
  priority?: boolean;     // home.hero のみ true
};
export const SLOT_REGISTRY: readonly PageSlot[] = [ /* 44 スロット: 40 既存写真 (home.hero 含む) + 4 未来枠 */ ];
```

登録スロット (棚卸しより): home.hero / home.craft.1-3 / home.gallery.1-3 / about.facility.1-3 / about.gallery.1-2 / colors.hero / colors.band.1-3 / contact.hero / materials.methods.1-2 / materials.gallery.1-2 / process.steps.1-3 / process.gallery.1-3 / service.process.1-2 / service.gallery.1-2 / story.chapter.1-5 / shop.hero / shop.grade.1-3 / **story.portrait (新規)** / **shop.product.1-3 (新規、3 枠)**。

**確定件数 = 44 (§1 と一致。v1.4 実装時の実ページ突合で確定 — v1.2〜v1.4 の「45」は home.hero を「固定 40」と別枠で二重計上した誤り)**:
- 既存写真スロット 40: home.hero (1) + home.craft (3) + home.gallery (3) + about.facility (3) + about.gallery (2) + colors.hero (1) + colors.band (3) + contact.hero (1) + materials.methods (2) + materials.gallery (2) + process.steps (3) + process.gallery (3) + service.process (2) + service.gallery (2) + story.chapter (5) + shop.hero (1) + shop.grade (3)
- 新規プレースホルダ枠 4: story.portrait (1) + shop.product (3)
- 合計 40 + 4 = **44** (home.hero は上記 40 の内数)

---

## 4. 公開ページ側の実装

### 4.1 リゾルバ (MAJOR-2/MAJOR-5/v1.2/BLOCKER-v1.4 対応)
`resolveAll(): Promise<Result<Record<string, ResolvedSlot>>>` (SSR, anon client 経由で `page_media_resolved` view を 1 回 SELECT、`unstable_cache` tag `page_media`)。

**BLOCKER-v1.4: 戻り値は `Map` ではなく plain object (`Record<string, ResolvedSlot>`)**。Next 15.5 の `unstable_cache` は保存時 `JSON.stringify` / 復元時 `JSON.parse` するため、`Map` はキャッシュヒット時に `{}` に化けて壊れる (node_modules/next/.../unstable-cache.js で確認済み)。**キャッシュ境界を通る値は JSON-safe に限る**を本設計の不変条件とする (`Map`/`Date`/`undefined` プロパティ禁止)。

```ts
type ResolvedSlot = {
  src: string | null;      // null = プレースホルダ表示 (未来枠かつ未設定)
  alt: string;
  mediaId: string | null;  // null = 既定 / 未設定
  isDefault: boolean;      // true = registry の default_src が使われている
  source: "page_media" | "default" | "placeholder";
};
type ResolvedSlots = Record<string, ResolvedSlot>; // slotKey → slot。JSON-safe
```

- **1 クエリで完結** (v1.2): `select slot_key, media_id, alt_override, media_alt from page_media_resolved` を全行取得し、registry を走査して各 slot の ResolvedSlot を組み立てる (v1.1 の RPC は廃止)。
- alt 決定順は §2.2 準拠: `alt_override ?? media_alt ?? registry.altDefault`。
- src は media_id があれば media facade の決定論 URL `{SUPABASE_URL}/storage/v1/object/public/media/{media_id}.webp`。**V0 補修 (§2.3) 完了後は全 media でこの URL が有効**。無ければ `registry.defaultSrc`、それも null なら null (プレースホルダ)。
- **2 つの読み方** (v1.3):
  - `resolveAll()` — 公開 (site) ページ用。`unstable_cache` tag `page_media`、keyParts に `["page_media", REGISTRY_HASH]`(`REGISTRY_HASH` は build 時に registry の JSON 内容を sha1 で計算した定数。registry のコード変更がキャッシュに残らない)。
  - `resolveAllFresh()` — `/edit` ルート (§5.3) 用。キャッシュを介さず直接クエリ。`/edit` は force-dynamic なので毎リクエスト最新が返る。
- 公開側への反映は §5.5b で境界を規定 (失効タグ/パスの列挙)。
- エラー時は全 slot を `isDefault=true` で返し、公開ページが落ちない。

### 4.2 画像コンポーネント + ページボディ抽出 (MAJOR-4/MAJOR-7/v1.3 対応)

**editMode は props でのみ伝搬する** (v1.3 で cookie/searchParams 判定を全廃)。ルートが静的に決める:

- **ページボディ抽出**: 各 `(site)/xxx/page.tsx` の JSX 本体を `XxxPageBody({ slots, editMode }: { slots: ResolvedSlots; editMode: boolean })` として抽出する (置き場所は各ページの `page-body.tsx` 併設)。**ページボディはデータを受け取る純粋な表示コンポーネント**とし、データ取得 (slots + works/posts/voices) は呼び出し側ルートが行う (MAJOR-v1.4 の freshness 切り替えのため):
  - `(site)/xxx/page.tsx` = cached 経路: `resolveAll()` + 既存の `getPublished*` (unstable_cache 経由)。generateMetadata / generateStaticParams は従来どおり (site) 側に残す。**公開ルートは request-time API を一切読まず、現状どおり純 SSG のまま**。
  - `/edit` ルート (§5.3) = fresh 経路: `resolveAllFresh()` + **content も fresh fetch** (§5.3 参照)。
- 新規 `SlotImage`(`src/components/site/slot-image.tsx`): props `slotKey` + `resolved: ResolvedSlot` + `editMode: boolean`。**context は使わない** (RSC で不可)。registry から aspect/sizes/priority を引き `<Image>` を描画。
- **data 属性は `editMode === true` のときだけ出力**: `data-editable-slot={slotKey}` `data-editable-media={mediaId ?? ''}` `data-editable-default={isDefault}`。editMode=false のレンダーパスには data 属性のコードパス自体が prop 固定で無効 — 公開 HTML への混入は条件分岐ミスでも起こらない (公開ルートは常に false を渡すため)。
- `PhotoFigure` (`page-blocks.tsx`): 内部 `<Image>` を SlotImage 化 (slotKey/editMode を受け取る拡張)。キャプション装飾は維持。
- `MediaCover` (works/voices/posts): editMode=true のとき `data-editable-content="{kind}:{id}:cover"` と `data-editable-media={現 media_id ?? ''}` を出力 (後者は §6 の CAS 用 old_media_id としてオーバーレイが読む)。
- 施工事例詳細のギャラリー画像 (work_images): editMode=true のとき `data-editable-work-image="{work_id}:{media_id}"` を出力。sort_order は data 属性に**出さない** (v1.3: クライアント値は信用せず Server が読み直すため不要、§6.1)。
- 固定 40 箇所の `<Image src="/img/..">` を `<SlotImage slotKey="..">` に置換。resolved はページボディが props で受けた slots から引く。
- **hero**: トップの `/hero.jpg` を `SlotImage slotKey="home.hero"` に。hero テキスト部は settings.hero のまま (BLOCKER-1 で media_id は除去済み)。
- **未来枠 4 スロット**: story.portrait / shop.product.1-3 の COMING SOON 位置に SlotImage を追加。default なし → 未設定時はプレースホルダ (editMode でもクリック可能)。

### 4.3 不変条件
- SlotImage 未設定時の見た目 = 現状の固定画像と同一 (default_src が現 src)。**移行しても公開サイトは一切変わらない**。
- aspect/sizes/priority は registry 由来でコンポーネント固定。src/alt のみ可変。
- **公開 (site) ルートの HTML に data-editable-* は構造的に存在しない** (editMode=false がルートでハードコードされ、判定ロジックが存在しないため)。
- 公開 (site) ルートは v1.3 実装後も cookies()/headers()/searchParams を読まない (SSG 維持)。これを退行させる変更は本設計違反。

---

## 5. ビジュアルエディタ `/admin/visual`

### 5.1 構成
```
[ページ選択タブ: トップ/会社案内/サービス/…]  ← registry の page 一覧
┌─────────────────────────────────────┐  ┌─────────────────┐
│  <iframe src="/edit/{route}">       │  │ 空スロット一覧   │  ← BLOCKER-3
│    実物ページを縮小表示 (同一オリジン) │  │ (このページで写真が│    対応
│    親が data-editable-* から座標取得 │  │  無いカードの一覧) │
│    → ホットスポット重畳 → クリックで│  │ クリックで         │
│      メニュー: 変更/alt/既定に戻す   │  │ MediaPicker → 保存 │
└─────────────────────────────────────┘  └─────────────────┘
```

### 5.1a 動的詳細ページへの導線 (v1.5 — V2b 検証で判明した仕様の空白を補完)

ページ選択タブは EDITABLE_ROUTES のうち**静的 route のみ**を出す (動的パターン `works/[slug]` 等はタブにならない)。work_images (ギャラリー) は施工事例**詳細ページにしか出ない**ため、次の 2 段ナビで到達させる:

- `/works` タブ選択時、サイドパネルに **公開済み施工事例のリスト**を追加表示する (slug + タイトル)。
- 事例クリック → iframe を `/edit/works/{slug}` に切り替え、その詳細ページ上で cover / ギャラリー (work_images) のホットスポット編集を行う。
- notes/blog の詳細ページ導線は**当面付けない** (posts.cover は一覧ページのカードでも編集可能なため。将来必要なら同方式で拡張)。
- voices は一覧ページで photo 編集が完結する (詳細ページなし)。

### 5.2 動作シーケンス
```
1. /admin/visual (admin gated) で page を選択 → iframe src = /edit/{route} (§5.3)
2. iframe onload + iframe 内 DOMContentLoaded + Reveal アニメ終了イベント (custom event)
   の 3 種すべてを待って初回測定 (MAJOR-6 対応)
3. 親が iframe.contentDocument から [data-editable-slot] /
   [data-editable-content] / [data-editable-work-image] 要素の getBoundingClientRect()
   を取得しホットスポット描画。iframe rect + 内側 rect + scroll + scale 合成で親座標系へ写像。
   同時に親が contentDocument へ capture-phase listener を注入して preventDefault
   (同一オリジンなので可能)。対象イベントは click / auxclick / submit の 3 種
   (MINOR-v1.4: 中クリック遷移とフォーム送信も止める。スクロールは阻害しない)
4. 追従: iframe 内 window の scroll + resize、iframe 自身の ResizeObserver、
   各画像の img.onload (lazy 遅延読み込み後の再測定。**注入時点で img.complete === true
   の画像は即測定** — キャッシュ済み画像は onload が発火しない、MINOR-v1.4)、
   Reveal 完了 (Reveal コンポーネントに custom event `kmb:reveal-done` を追加実装して通知)、
   requestAnimationFrame ループでスクロール中の粘着追従
5. ホットスポット click → 小メニュー (画像を変更 / alt 編集 / 既定に戻す)
6. 「画像を変更」→ MediaPicker (単一選択、汎用ラベルに MINOR-3 対応)
7. Server Action で保存 (§6 参照)。DB commit → return 前に revalidate (§5.5b)
8. クライアントは成功 Result を受け取ってから iframe.contentWindow.location.reload()。
   /edit は force-dynamic なので reload = 常に DB 最新 (公開側キャッシュの失効を待たない)
```

### 5.3 編集プレビュー専用ルート `/edit/**` (BLOCKER-v1.3 対応)

v1.2 の「admin cookie + `?__edit=1` で公開ルートを edit モード化」は廃止する。理由:
1. **実装不能**: edit-token を Server Component の `cookies().set()` で発行する設計は Next.js の制約 (RSC は cookie 読み取り専用) に反していた。
2. **性能退行**: 公開ページに searchParams/cookies 判定を入れると、現在純 SSG の全公開ページが動的レンダリングに落ちる (コード調査で全 (site) ページが request-time API 非依存であることを確認済み)。
3. **キャッシュ汚染リスク**: 同一 URL パス上で公開 HTML と edit HTML を出し分ける限り、キャッシュキー設計のミスが即漏洩になる。

**v1.3 の設計 — URL パスで物理分離する**:

- **ルート**: `src/app/(editor)/edit/[[...path]]/page.tsx`
  - `export const dynamic = "force-dynamic"` — 毎リクエスト最新、Route Cache に載らない。
  - ページ内で `platformFacade.requireAdmin()` を必ず呼び、失敗時は `notFound()`。middleware と合わせて 2 層 (defense in depth、admin 側の既存パターンと同じ)。
  - `path` セグメントを **EDITABLE_ROUTES (§5.3a)** に対してホワイトリスト照合し、該当するページボディ (§4.2) を `editMode={true}` で描画する。照合に失敗したら `notFound()` — 任意パスの反射はしない。
  - **データは全て fresh fetch** (MAJOR-v1.4): page_media は `resolveAllFresh()`、works/posts/voices は **unstable_cache を通らない素の fetch 関数**を使う。現行 `src/app/_lib/public-content.ts` は cached 関数のみ export しているため、V2a で「素の fetch 関数」(例: `fetchPublishedWorks`) を分離 export し、cached 版はそれを `unstable_cache` で包む 2 層構造にリファクタする。(site) は cached 版、/edit は素版。**これにより /edit の reload = 常に DB 最新が page_media にも content にも成立**し、revalidateTag の伝播を待たない。
  - layout ((editor) グループ): (site) と同じ SiteHeader/Footer 構成で見た目を一致させ、`metadata.robots = { index: false, follow: false }` を設定。
- **middleware**: matcher を `["/admin/:path*", "/edit/:path*"]` に拡張。既存ロジックそのまま — 未ログインは `/admin/login` へリダイレクト。
- **login の next パラメータ** (MINOR-v1.4): 現行 login は `/admin` 系以外の next を捨てる。`/edit/**` も戻り先ホワイトリストに追加する (許可 prefix = `/admin` `/edit`、相対パスのみ受け付けてオープンリダイレクトを防ぐ — 既存実装の方針踏襲)。
- **robots.txt**: `/admin` と `/edit` を disallow に追加 (現状 robots.ts に disallow が無いことを調査で確認。あわせて修正)。
- **iframe**: `/admin/visual` から `<iframe src="/edit/{route}">`。同一オリジンなので親から contentDocument が読める。

**脅威モデル (v1.3)**:
- 匿名 / 非 admin が `/edit/**` にアクセス → middleware でログイン画面へリダイレクト。HTML は 1 バイトも返らない。
- admin が誤って `/edit/...` URL を第三者に共有 → 受け手は admin セッションを持たないためログイン画面。v1.2 の「?__edit=1 付き URL の共有事故」は構造的に消滅。
- 公開 (site) ルートには data 属性のコードパス自体が無い (§4.3) — 公開キャッシュに edit HTML が乗る経路が存在しない。
- iframe 内で任意 JS を実行させない (親が DOM 座標を読み、クリックを preventDefault するだけ)。
- 保存の最終防御は RLS。data 属性の値を偽装しても write は admin RLS で拒否。Server Action は Next ビルトインの Origin ヘッダ検証 + requireAdmin。
- クリックジャッキング: next.config の headers() で `/edit/:path*` と `/admin/:path*` に `X-Frame-Options: SAMEORIGIN` を付与 (現状ヘッダ設定は無し — 新規追加)。公開ルートには付けない (現状維持)。

**トレードオフ (明示)**: /edit 用にページボディ抽出 (§4.2) が必要になるが、これは V2a で全ページを触る作業に含まれる差分であり追加コストは小さい。新規公開ページ追加時は page-map (§5.3a) への登録が必要 — registry と page-map の整合は単体テストで強制する (§8)。

### 5.3a ページマッピングと EDITABLE_ROUTES (MAJOR-v1.4 対応)
`src/app/(editor)/edit/page-map.tsx` に「path パターン → ページボディ」の対応を一元定義:
- 静的: `"" | "about" | "colors" | "contact" | "materials" | "notes" | "process" | "service" | "shop" | "story" | "voices" | "works" | "blog"` → 各 Body
- 動的: `works/{slug}` / `notes/{slug}` / `blog/{slug}` → 各 Detail Body (slug は DB 照合、無ければ notFound)
- privacy / tokushoho は編集対象スロットが無いため page-map に**含めない** (registry にも slot が無い)。

**EDITABLE_ROUTES 定数** (page-media/registry.ts に併設): 編集対象ルートの全量 =
1. `SLOT_REGISTRY` の全 route (ページスロットを持つページ)
2. コンテンツ画像を持つ一覧ページ: `/works` `/voices` `/notes` `/blog` (スロットは無いが cover/photo の data-editable-content が出る)
3. 動的 detail パターン: `works/[slug]` `notes/[slug]` `blog/[slug]`

単体テストは **EDITABLE_ROUTES の全量**が page-map で解決できることを assert する (v1.3 の「SLOT_REGISTRY の route のみ」ではコンテンツ画像専用ページを取りこぼす — MAJOR-v1.4)。/admin/visual のページ選択タブも EDITABLE_ROUTES から生成する。

### 5.4 空スロット可視化 (BLOCKER-3 対応)
- iframe クリックだけに頼らない。**サイドパネル**に「そのページ (route) が持つべき全 slot」を registry から一覧し、resolveAll の結果と突き合わせて `state = default | custom | placeholder | 未使用DOM` を各行に表示。
- 対象:
  - コンテンツ画像側で null (`voices.photo=null` の声 / `posts.cover=null` の記事) → 公開ページに DOM が出ないので iframe 内には映らない。サイドパネルからだけ設定できる。
  - `story.portrait` / `shop.product.*` (未来枠) → プレースホルダ DOM は出るが、サイドパネルにも重複掲載して確実にたどれるように。
- サイドパネル行をクリック → 対応する DOM が iframe にあればスクロールしてハイライト、無ければ直接 MediaPicker を開く。

### 5.5b 保存境界と cache 失効 (MAJOR-v1.2 / MINOR-v1.3 対応)

Server Action の実装契約:
1. Zod parse → 権限確認 (requireAdmin — settings actions と同じパターン。works actions の「requireAdmin 未接続」実装差は踏襲しない)
2. **DB commit まで完了** (page_media upsert / ContentFacade 経由の works/voices/posts 更新 / work_images RPC の atomic 更新)
3. **DB commit 後、Server Action の return 前に invalidation 関数を呼ぶ** (revalidatePath / revalidateTag は同期 API であり await 対象ではない — v1.2 の「await で完了させて」は表現誤り):
   - ページスロット保存: `revalidatePath(route)` + `revalidateTag("page_media")`
   - works.cover / work_images 保存: `revalidatePath("/works")` + `revalidatePath("/works/" + slug)` + `revalidateTag("works")` (v1.3: 一覧 `/works` を明示追加 — カバーは一覧カードにも出るため)
   - voices.photo 保存: `revalidatePath("/voices")` + `revalidateTag("voices")`
   - posts.cover 保存: 対象 post の kind に応じて `revalidateTag("posts:" + kind)` + 該当 path (`/notes` + `/notes/{slug}` または `/blog` + `/blog/{slug}`)。全 kind を無差別に失効させない (既存 content facade の tagForKind パターン踏襲)
4. Server Action の Result を返却 → **クライアントは成功 Result を受け取ってから** `iframe.contentWindow.location.reload()` を呼ぶ。

**エディタの即時反映は revalidate に依存しない** (v1.3/v1.4): iframe が読む `/edit/**` は force-dynamic で、page_media は `resolveAllFresh()`、**works/posts/voices の content データも素の fetch 関数** (§5.3 の 2 層化) を使うため、reload すれば必ず DB 最新。上記の失効は**公開 (site) 側**を最新化するためのもので、多少の伝播遅延を許容する。

**revalidateTag 単引数 API の採用判断** (MAJOR-v1.2 の (2) への回答): 本リポジトリは Next 15.5.20 で、既存コードベース全体 (content facade 8 箇所 / admin actions) が `revalidateTag(tag)` / `revalidatePath(path)` の安定 API を使用している。`unstable_expireTag` への移行はリポジトリ横断変更となり本フェーズのスコープ外。エディタの即時性要件は上記のとおり /edit ルートで満たすため、公開側は既存 API の失効セマンティクス (次回アクセス時に再生成) で十分。将来 Next を更新して `updateTag` 系が安定化した際に一括移行する。

**タグと path の両方を叩く根拠**: `unstable_cache` は tag ベース、Route Cache は path ベースで独立管理のため。片方だけだと片方が古いまま残る。

### 5.5 メディア削除ガード拡張 (E301 / MAJOR-8)
migration 0013 で **同時に更新**する 3 箇所:
1. `page_media` の RLS ポリシー (新規)
2. `media_reference_summary` view (`page_media` 参照カウントを合算) — **DROP + CREATE** で置換
3. `media_admin_delete` RLS ポリシー (0002) — page_media 参照ゼロ判定を追加。**DROP + CREATE** で置換
これらは 1 migration で atomic に適用する。UI 側の削除ボタン活性判定も `reference_count` を再取得すれば自動追従。

---

## 6. facade / 契約

```ts
// src/modules/page-media/facade.ts
export interface PageMediaFacade {
  resolveAll(): Promise<Result<ResolvedSlots>>;      // 公開 SSR 用 (unstable_cache + view 1 クエリ)。Record — Map 禁止 (§4.1 BLOCKER-v1.4)
  resolveAllFresh(): Promise<Result<ResolvedSlots>>; // /edit 用 (キャッシュ非経由、§4.1)
  listForAdmin(route?: string): Promise<Result<Array<PageSlotState>>>; // route 絞り込み可能
  setSlot(slotKey: string, mediaId: string | null): Promise<Result<void>>;
  setSlotAlt(slotKey: string, alt: string | null): Promise<Result<void>>;
}
// ESLint: eslint.config.mjs の MODULES 配列に "page-media" を追加する
// (他モジュールからは facade 経由のみ import 可、internal/repository 直 import 禁止)

// ContentFacade への追加 (BLOCKER-2 / MAJOR-v1.2 / MAJOR-v1.4 対応):
//   setWorkCover(workId, oldMediaId|null, newMediaId|null)
//   setVoicePhoto(voiceId, oldMediaId|null, newMediaId|null)
//   setPostCover(postId, oldMediaId|null, newMediaId|null)
//   setWorkImage(workId, oldMediaId, newMediaId|null)
//     ← work_images ギャラリー 1 行の置換。atomic RPC を呼ぶ (§6.1 の replace_work_image)
//
// 楽観排他 (MAJOR-v1.4 で work_images と対称の CAS に統一):
//   cover/photo 系は data-editable-content のクリック時点の表示 media_id を old として送り、
//   「cover_media_id が old と一致する行だけを new に更新」する CAS にする。
//   意味論は SQL の is not distinct from (null 同士も一致) と同じ。
//   一致行なし = KMB-E109 (他所で先に変更された)。UI は「リロードして最新を確認」。
//   updated_at ベースの排他は使わない (visual editor は「見えている画像」が比較対象として自然で、
//   works フォーム全体の updated_at 排他と競合しない)。
//
// Supabase JS での実装メモ (MINOR-v1.4-final、Codex 確認済み):
//   - PostgREST は is not distinct from を直接書けないため、
//     old が null → .is("cover_media_id", null) / 非 null → .eq("cover_media_id", old) で等価にする
//   - update() は既定で更新行を返さないため、.select("id") をチェーンし
//     data が空 (0 行) を KMB-E109 に写像する (affected rows の判定はこれで行う)
```

Zod 契約 (`page-media/contracts.ts`):
- `zSetSlotReq { slot_key: registry のキーに限定, media_id: uuid|null }`
- `zSetSlotAltReq { slot_key, alt: string|null (max 200) }`

ContentFacade 側の追加 Zod (`content/contracts.ts`):
- `zSetWorkImageReq { work_id: uuid, old_media_id: uuid, new_media_id: uuid|null }`
- `zSetContentCoverReq { kind: 'work'|'voice'|'post', id: uuid, old_media_id: uuid|null, new_media_id: uuid|null }` (MAJOR-v1.4 の CAS 用。old_media_id はクライアント提示の楽観排他期待値 — 偽装しても CAS が失敗するか自分の変更が上書きされるだけで、権限は RLS が最終防御)

Server Action シグネチャ (`src/app/admin/visual/actions.ts`):
- `setImage(target: EditableTarget, mediaId: string|null)` — `EditableTarget` は discriminated union で slot/content/work-image を判別

---

## 6.1 work_images 置換の atomic 契約 (MAJOR-v1.2 / MAJOR-v1.3 対応)

sort_order はクライアントから受け取らない。**Server (RPC) が対象行から読み直して維持**する。以下の RPC を migration 0013 で追加し、setWorkImage はこの RPC のみを呼ぶ:

```sql
create or replace function public.replace_work_image(
  p_work_id uuid,
  p_old_media_id uuid,
  p_new_media_id uuid   -- null は「削除」
)
returns void
language plpgsql
security invoker  -- admin RLS (migration 0012 の is_admin() 書き込みポリシー) を適用する
set search_path = public
as $$
declare
  v_sort_order int;
begin
  -- 1) 対象行を FOR UPDATE でロック取得。存在しなければエラー
  select sort_order into v_sort_order
  from work_images
  where work_id = p_work_id and media_id = p_old_media_id
  for update;

  if not found then
    raise exception 'KMB-E109: work_images(%, %) not found', p_work_id, p_old_media_id;
  end if;

  -- 2) 削除ケース
  if p_new_media_id is null then
    delete from work_images where work_id = p_work_id and media_id = p_old_media_id;
    return;
  end if;

  -- 3) 同一 work_id に new_media_id が既に存在すると PK (work_id, media_id) 一意違反。
  --    409 相当のエラーで返し、UI が「既に追加されている画像です」と表示。
  if exists (
    select 1 from work_images
    where work_id = p_work_id and media_id = p_new_media_id
  ) then
    raise exception 'KMB-E108: work_images(%, %) already exists', p_work_id, p_new_media_id;
  end if;

  -- 4) delete + insert を同一トランザクションで (関数全体が 1 tx)
  delete from work_images where work_id = p_work_id and media_id = p_old_media_id;
  insert into work_images (work_id, media_id, sort_order)
  values (p_work_id, p_new_media_id, v_sort_order);

exception
  -- MAJOR-v1.3: 事前 exists チェックをすり抜ける同時挿入 (別トランザクションが同じ
  -- p_new_media_id を先に insert) は PK unique_violation になる。E108 に正規化する。
  when unique_violation then
    raise exception 'KMB-E108: work_images(%, %) already exists (concurrent insert)', p_work_id, p_new_media_id;
end;
$$;

revoke execute on function public.replace_work_image(uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_work_image(uuid, uuid, uuid) to authenticated;
-- 実行は admin セッションを想定。RLS は work_images への is_admin() 書き込みポリシー (migration 0012) で担保。
-- (revoke/grant パターンは 0009 ai_run_* の前例踏襲)
```

エラー扱い:
- 対象行なし → **KMB-E109** (v1.3 で E404 から変更。**KMB-E404 は AI カテゴリ「生成物の制約違反」で既に使用済み**のため衝突を回避)。UI は「対象が見つかりません。画面を再読み込みしてください」。
- new_media_id が同一 work に既存 (事前チェック / 同時挿入の unique_violation の両方) → **KMB-E108**。
- その他の失敗 → 例外がそのままトランザクションを rollback。
- repository 層は RPC の例外メッセージ先頭の `KMB-E1xx` を parse して Result の code に写像する。parse 不能な例外は KMB-E901 (システムエラー)。

Zod (`content/contracts.ts`):
```ts
export const zSetWorkImageReq = z.object({
  work_id: z.string().uuid(),
  old_media_id: z.string().uuid(),
  new_media_id: z.string().uuid().nullable(),
}).strict();
```

## 7. エラーコード (追加)

既存採番の事実 (src/modules/platform/errors.ts): 1xx=入力検証 (E101-E103 使用済み)、4xx=AI (**E404 は「生成物の制約違反」で使用済み**)。新規コードは 1xx の続き番号で採る。

| コード | 意味 | 復旧 |
|---|---|---|
| KMB-E107 | 未知の slot_key (registry 外) | 再読み込み。registry と DB の整合を確認 |
| KMB-E108 | work_images 置換時に同一 work に同 media が既存 (同時挿入含む) | 別の画像を選ぶか、既存画像を先に削除 |
| KMB-E109 | 置換対象の行/コンテンツが見つからない | 画面再読み込みで最新化 |
| (E301 拡張) | page_media 参照中 media の削除 | 参照元 (ページ名) を提示 |

---

## 8. テスト戦略
| レイヤ | 対象 |
|---|---|
| 単体 | registry の一意性/route 妥当性、**EDITABLE_ROUTES 全量が page-map (§5.3a) で解決できる**、resolver の fallback (media/null/未登録) と **戻り値が JSON round-trip 不変 (Map 混入検知、BLOCKER-v1.4)**、zSetSlotReq の slot_key 検証、zSetContentCoverReq、RPC 例外メッセージ → KMB コード写像 |
| 結合 | page_media RLS (anon select / admin write)、setSlot upsert + 既定復帰、E301 に page_media 参照が効く、replace_work_image の E108/E109、**cover CAS の affected 0 → E109** |
| E2E (実ブラウザ) | /admin/visual で iframe (/edit/{route}) ロード → ホットスポット表示 → クリック → MediaPicker → 差し替え → iframe reload で反映 → 公開ルートで実データ反映。**キーボード**: メニューの Tab/Enter/Esc。空スロット (未来枠) の設定。既定に戻す。**匿名で /edit/** にアクセスしログインへリダイレクトされる** |
| 非影響 | SlotImage 導入後、未設定状態の公開ページが移行前とスナップショット一致 (見た目不変)。公開 (site) ページが SSG のまま (build 出力で ○ Static を確認) |
| V0 補修 | 全 media 行の `{id}.webp` が 200、公開ページ全画像が実ブラウザで表示 (現在 400 で壊れている works/voices/posts 画像の回復確認)、既存 156 テスト PASS |

---

## 9. フェーズ分割 (1 セッション一括、wave 並列)
| wave | 内容 | 並列 | 依存 |
|---|---|---|---|
| **V0** | **メディア URL hotfix (§2.3)**: toPublicMediaRef 決定論 URL 化 (公開画像 400 の実バグ修正) + verify-media-renditions.ts + 実行・検証。**実装 GO と独立に先行可** | 単独 | — |
| V1 | page_media DDL (0013 apply) + registry + EDITABLE_ROUTES + resolver (2 モード、Record 契約) + facade + Zod + ESLint MODULES 追加。E301/view 拡張 | 単独 | — (V0 と並列可) |
| V2a | 公開ページ: ページボディ抽出 (§4.2) + public-content の fetch/cache 2 層化 + SlotImage / PhotoFigure / MediaCover の editMode 対応 + 固定 40 枚置換 + hero 接続 + 未来枠 4 スロット追加 + /edit ルート (§5.3) + middleware/robots/headers/login-next | 並列 (ページ群で分割可) | V1 |
| V2b | /admin/visual エディタ (iframe overlay + ホットスポット + メニュー + MediaPicker 連携 + Server Actions + nav 追加) | 並列 | V1 (data 属性の契約だけ先に固定) |
| V3 | 統合 + Codex レビュー + 実機 E2E (実ブラウザで差し替え→反映) + 見た目非影響確認 | 単独 | V0+V2a+V2b |

- V2a はページ数が多いので implementer 複数 + worktree 分離。data 属性の命名規約 (§1) と ページボディ抽出の雛形を先に確定して各 implementer に渡す。
- 実装は全て worktree 分離 (main 直接作業の共有ツリー事故を回避)。

---

## 10. 非機能・移行
- 移行: seed で page_media は**空**でよい(未設定 = 既定画像)。既存の見た目を維持したまま、堀さんがエディタで 1 枚ずつ実写に差し替えていく運用。
- 性能: resolveAll は 1 クエリ + タグキャッシュ。ページ描画への追加コスト最小。
- 既存 `site_settings.hero.media_id` は 0013 で削除 (page_media.home.hero へ一本化)。hero テキストは settings 継続。seo_defaults.og_media_id の接続は本 Phase 対象外 (別途)。
- MINOR: `/admin/visual` を admin nav-items.ts に追加。MediaPicker のヘッダー文言を「画像を選ぶ」に汎用化 (works/posts の「カバー画像」ラベルは呼び出し側 props で上書き)。
- robots.ts に `/admin` `/edit` の disallow を追加 (現状 disallow 無しの是正、§5.3)。

---

## 11. Codex 外部レビュー v1.0 → v1.1 対応表

| 指摘 | 重大度 | 対応節 |
|---|---|---|
| hero が settings と page_media で二重管理 | BLOCKER-1 | §1 hero 一本化 + §2 migration で `site_settings.hero.media_id` 削除 |
| work_images の保存契約が無い | BLOCKER-2 | §1 に work_image 種別追加、§6 に setWorkImage / zSetWorkImageReq |
| 空スロットのエディタ導線が DOM 無しでは成立しない | BLOCKER-3 | §5.4 空スロットサイドパネル |
| alt フォールバック順が不完全 | MAJOR-1 | §2.2 alt 決定順を明記 |
| resolver 型が不足 | MAJOR-2 | §4.1 に ResolvedSlot 型定義 |
| revalidateTag 単引数が非推奨 | MAJOR-3 | §5.2 で revalidatePath + revalidateTag 併用、iframe reload 明記 |
| 公開ページへの data 属性常時出力の脅威モデル未記載 | MAJOR-4 | §4.2 edit モード条件 + §5.3 脅威モデル |
| cache keyParts に registry version が無い | MAJOR-5 | §4.1 REGISTRY_HASH を keyParts に |
| iframe 座標追従の設計不足 | MAJOR-6 | §5.2 初回測定 3 種待ち + 追従 5 経路 |
| RSC で React context 非対応 | MAJOR-7 | §4.2 props で resolved を渡す |
| E301 の RLS ポリシー本体も更新対象 | MAJOR-8 | §5.5 RLS + view + reference count を 1 migration で atomic 更新 |
| 数の食い違い (44 vs 45) / nav 未追加 / MediaPicker 文言 | MINOR | §1 で 45 に統一、§10 で nav 追加と汎用化 |

## 11.1 Codex 再レビュー v1.1 → v1.2 対応表
| 指摘 | 重大度 | 対応節 |
|---|---|---|
| rpc_get_page_media_all の security definer が RLS 回避 | BLOCKER | §2 で RPC 撤回、anon SELECT ポリシー + view (page_media_resolved) に変更 |
| edit cookie 仕様 / cache 分離が未定義 | MAJOR | §5.3 に kmb-edit-token の HMAC 署名 / HttpOnly / SameSite=Strict / Max-Age 1800 と ?__edit=1 の Route Cache 分離 + unstable_noStore |
| work_images 置換の atomic 契約が粗い | MAJOR | §6.1 に replace_work_image RPC (FOR UPDATE + sort_order Server 側維持 + PK 衝突 → E108 + not found → E404) を新設 |
| resolver が alt/URL 材料を RPC から取れていない | MAJOR | §2 view に media.alt を join、§4.1 は 1 クエリで完結、RPC は不使用 |
| revalidate 順序と失効タグ拡張 | MAJOR | §5.5b に「DB commit → revalidate(await) → 200 応答 → client reload」の境界と、content 系失効タグ (works/voices/posts:*) を列挙 |
| 数の食い違い (44 vs 45) | MINOR | §3 に 41 既存写真 + 4 未来枠 = 45 の内訳を明記、他箇所も統一 |

## 11.2 Codex 再々レビュー v1.2 → v1.3 対応表 (GitHub Issue #2-#10)

| Issue | 指摘 | 重大度 | v1.3 の対応 |
|---|---|---|---|
| #2 | Server Component で cookies().set() は不可 (edit-token 発行経路が実装不能) | BLOCKER | **edit-token 機構を全廃**。編集プレビューを専用 `/edit/**` 動的ルート (middleware + requireAdmin の 2 層) に分離 (§5.3)。cookie 発行そのものが不要に |
| #3 | security_invoker view と「base table に direct grant しない」が矛盾 | BLOCKER | page_media を公開メタデータと割り切り anon SELECT を RLS で明示許可。唯一の秘匿候補 updated_by 列を**廃止**して露出情報ゼロに (§2)。view は join の利便目的に格下げ |
| #4 | edit 判定を searchParams+cookies の request-time 契約に | MAJOR | より強い解で対応: URL パス分離 (§5.3)。公開ページは SSG のまま (searchParams 方式は全公開ページを動的化させるため不採用 — 判断根拠を §5.3 に明記)。editMode は props 固定 (§4.2) |
| #5 | revalidateTag 単引数 API / works 一覧 path 漏れ | MAJOR | `/works` を失効 path に追加。単引数 API は既存コードベース踏襲と判断根拠を §5.5b に明記 (即時性は /edit force-dynamic で担保) |
| #6 | replace_work_image の同時挿入で unique_violation が E108 に正規化されない | MAJOR | `exception when unique_violation then raise KMB-E108` を追加 (§6.1) |
| #7 | `{media_id}.webp` 前提が legacy media で崩れる | MAJOR | 調査で URL 生成 2 系統分裂 (公開=storage_path / admin={id}.webp) と新規アップロード画像の公開側 404 潜在バグを確認。**V0 補修フェーズ新設** (§2.3): 修復スクリプト + 決定論 URL への統一 |
| #8 | cookie 名の表記ゆれ (x-edit-token / kmb-edit-token) | MINOR | token 機構廃止により該当記述を全削除 |
| #9 | 「revalidate を await」は表現不正確 | MINOR | 「DB commit 後、return 前に invalidation 関数を呼ぶ」に修正 (§5.5b) |
| #10 | HMAC 署名対象に exp を含める | MINOR | token 機構廃止により不要 |

追加の独自修正 (v1.3): KMB-E404 が既存 AI エラーコードと衝突していたため E109 に採番変更 (§7)。robots.ts の /admin /edit disallow 追加 (§5.3)。migration 番号の正誤 (0013 は未作成、これから作る) を §2 に明記。

## 11.3 Codex v1.3 レビュー → v1.4 対応表

| 指摘 | 重大度 | v1.4 の対応 |
|---|---|---|
| unstable_cache は JSON round-trip するため Map 契約が壊れる | BLOCKER | resolver/facade の戻り値を `Record<string, ResolvedSlot>` に変更。「キャッシュ境界を通る値は JSON-safe 限定」を不変条件化 + Map 混入検知テスト (§4.1/§6/§8) |
| /edit の即時反映はページスロット限定 (content は unstable_cache 経由) | MAJOR | public-content を「素の fetch 関数 + cached ラッパ」の 2 層に分離し、/edit は content も fresh fetch (§5.3) |
| page-map テストが SLOT_REGISTRY route のみだと content 専用ページを取りこぼす | MAJOR | EDITABLE_ROUTES 定数 (slot routes ∪ /works /voices /notes /blog ∪ detail 3 パターン) を新設し全量テスト (§5.3a/§8) |
| cover 差し替えの楽観排他契約が不足 | MAJOR | setWorkCover/setVoicePhoto/setPostCover に old_media_id を追加し `is not distinct from` の CAS 更新。affected 0 → E109 (§6)。MediaCover は data-editable-media で現 media_id を出す (§4.2) |
| DDL に grant 明記が望ましい | MINOR | §2 に grant select/insert/update/delete を明記 |
| seed は既に {id}.webp を生成しており §2.3 の記述が古い | MINOR | 本番 HTTP 実測で確定 (storage_path 直=400 / {id}.webp=200)。**公開画像が現在壊れている実バグ**と判明し、V0 を hotfix + 検証スクリプトに再定義 (§2.3) |
| login の next が /admin 以外を捨てる | MINOR | /edit を戻り先ホワイトリストに追加 (§5.3) |
| preventDefault は click 以外も / img.complete / Reveal event | MINOR | click/auxclick/submit の 3 種 + img.complete 即測定 + `kmb:reveal-done` custom event を §5.2 の受入条件に追加 |

## 12. 更新履歴
| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-07-08 | 初版 |
| v1.1 | 2026-07-09 | Codex 外部レビュー 12 件反映 (BLOCKER 3 / MAJOR 8 / MINOR 1) |
| v1.2 | 2026-07-09 | Codex 再レビュー 6 件反映 (BLOCKER 1 / MAJOR 4 / MINOR 1) |
| v1.3 | 2026-07-09 | Codex 再々レビュー 9 件反映 (BLOCKER 2 / MAJOR 4 / MINOR 3)。edit-token 廃止 → /edit ルート分離、updated_by 廃止、V0 補修新設、E109 採番 |
| v1.4 | 2026-07-09 | Codex v1.3 レビュー 8 件反映 (BLOCKER 1 / MAJOR 3 / MINOR 4)。Record 契約・/edit fresh fetch・EDITABLE_ROUTES・cover CAS。本番実測で公開画像 400 の実バグ確認 → V0 を hotfix 化。**Codex 最終レビュー: BLOCKER 0 = 実装 GO** (MINOR 3 件 = CAS の Supabase 実装メモも反映済み) |
