# ビジュアル画像エディタ 設計書

- 版: v1.2 (Codex 再レビューで v1.1 の残 BLOCKER/MAJOR を潰す)
- 作成日: 2026-07-08 (v1.0) → 2026-07-09 (v1.1 → v1.2)
- 作成: Opus 4.8 (メインセッション直接執筆)
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
| **ページスロット** | 固定 40 枚 + hero + 新規 4 枠 (story.portrait / shop.product.1-3) = **計 45** | `data-editable-slot="home.hero"` | `page_media` テーブル (§2) |
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
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
-- default_src / page / section_label / aspect / sort_order 等の静的メタは DB に持たず
-- コード側の SLOT_REGISTRY (§3) が単一ソース。page_media は「差し替えられた分」だけを保持する。

create trigger handle_updated_at before update on page_media
  for each row execute procedure extensions.moddatetime (updated_at);

alter table page_media enable row level security;

-- BLOCKER-v1.2 対応: RPC + security definer による RLS 回避は撤回。
-- 正しい設計: page_media テーブル自体に anon SELECT を許可し (write は admin のみ)、
-- 露出列を絞る目的で anon には view 経由でだけアクセスさせる (直接 grant はしない)。
create policy page_media_anon_select on page_media for select using (true);
create policy page_media_admin_insert on page_media for insert with check (public.is_admin());
create policy page_media_admin_update on page_media for update using (public.is_admin()) with check (public.is_admin());
create policy page_media_admin_delete on page_media for delete using (public.is_admin());

-- 公開 (anon) は view 経由のみ。security_invoker=true で page_media の anon_select が効く。
-- MAJOR-v1.2 対応: resolver が 1 クエリで alt/URL 材料を得られるよう media を join。
create or replace view public.page_media_resolved
with (security_invoker = true) as
select
  pm.slot_key,
  pm.media_id,
  pm.alt_override,
  m.alt as media_alt,
  m.storage_path as media_storage_path -- 参考用 (公開 URL は {SUPABASE_URL}/storage/v1/object/public/media/{media_id}.webp)
from page_media pm
left join media m on m.id = pm.media_id;

grant select on public.page_media_resolved to anon, authenticated;
-- ※ 本テーブル page_media は anon が直接 SELECT できるが、
--    アプリ層では常に view 経由で読む (露出列の一貫性のため)。
--    updated_by は view に含めず、admin 画面のみ本テーブル直接クエリで取得する。

-- BLOCKER-1 対応: site_settings の hero.media_id を廃止 (テキストのみに縮退)。
-- 既存行があれば value から media_id を除去。
update site_settings
   set value = value - 'media_id'
 where key = 'hero'
   and value ? 'media_id';
```

`page_media` は **差分のみ保持**(upsert)。「既定に戻す」= その行を削除 or media_id=null。DDL 追加は **1 テーブル (page_media) + 1 view (page_media_resolved) のみ**。migration 連番は既存の続き (0013)。RPC は使わない (v1.1 の rpc_get_page_media_all は撤回)。

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
export const SLOT_REGISTRY: readonly PageSlot[] = [ /* 45 スロット: 41 既存写真 + 4 未来枠 */ ];
```

登録スロット (棚卸しより): home.hero / home.craft.1-3 / home.gallery.1-3 / about.facility.1-3 / about.gallery.1-2 / colors.hero / colors.band.1-3 / contact.hero / materials.methods.1-2 / materials.gallery.1-2 / process.steps.1-3 / process.gallery.1-3 / service.process.1-2 / service.gallery.1-2 / story.chapter.1-5 / shop.hero / shop.grade.1-3 / **story.portrait (新規)** / **shop.product.1-3 (新規、3 枠)**。

**確定件数 = 45 (§1 と一致)**:
- 既存写真スロット 41: home.hero (1) + home.craft (3) + home.gallery (3) + about.facility (3) + about.gallery (2) + colors.hero (1) + colors.band (3) + contact.hero (1) + materials.methods (2) + materials.gallery (2) + process.steps (3) + process.gallery (3) + service.process (2) + service.gallery (2) + story.chapter (5) + shop.hero (1) + shop.grade (3)
- 新規プレースホルダ枠 4: story.portrait (1) + shop.product (3)
- 合計 41 + 4 = **45**

---

## 4. 公開ページ側の実装

### 4.1 リゾルバ (MAJOR-2/MAJOR-5/v1.2 対応)
`resolvePageMedia(): Promise<Map<slotKey, ResolvedSlot>>` (SSR, anon client 経由で `page_media_resolved` view を 1 回 SELECT、`unstable_cache` tag `page_media`)。

```ts
type ResolvedSlot = {
  src: string | null;      // null = プレースホルダ表示 (未来枠かつ未設定)
  alt: string;
  mediaId: string | null;  // null = 既定 / 未設定
  isDefault: boolean;      // true = registry の default_src が使われている
  source: "page_media" | "default" | "placeholder";
};
```

- **1 クエリで完結** (v1.2): `select slot_key, media_id, alt_override, media_alt from page_media_resolved` を全行取得し、registry を走査して各 slot の ResolvedSlot を組み立てる (v1.1 の RPC は廃止)。
- alt 決定順は §2.2 準拠: `alt_override ?? media_alt ?? registry.altDefault`。
- src は media_id があれば `{SUPABASE_URL}/storage/v1/object/public/media/{media_id}.webp` (レンディション規約、cms §3.4 と一致)。無ければ `registry.defaultSrc`、それも null なら null (プレースホルダ)。
- `unstable_cache` の keyParts に `["page_media", REGISTRY_HASH]` を入れる。`REGISTRY_HASH` は build 時に registry の JSON 内容を sha1 で計算した定数 (registry.ts に `export const REGISTRY_HASH = ...` として出力)。**registry のコード変更がキャッシュに残らない**。
- 反映は §5.6 で厳密に境界を規定する (順序と失効タグの拡張)。
- エラー時は全 slot を `isDefault=true` で返し、公開ページが落ちない。

### 4.2 画像コンポーネント (MAJOR-4/MAJOR-7 対応)
- 新規 `SlotImage`(`src/components/site/slot-image.tsx`): props `slotKey` + `resolved: ResolvedSlot`。**context は使わない** (RSC で不可)。Server Component として親から props で resolved を渡す。registry から aspect/sizes/priority を引き `<Image>` を描画。
- **data 属性は「編集モード」のときだけ出力**する (MAJOR-4)。判定は Server Component で `cookies()` を読み `x-edit-token`(admin セッションが有効) + URL に `?__edit=1` があれば edit モード。この場合のみ `data-editable-slot={slotKey}` `data-editable-media={mediaId ?? ''}` `data-editable-default={isDefault}` を出す。通常の公開閲覧では data 属性は一切出ない (情報露出なし)。
- `PhotoFigure` (`page-blocks.tsx`): 内部 `<Image>` を SlotImage 化 (slotKey を受け取る拡張)。キャプション装飾は維持。
- `MediaCover` (works/voices/posts): 同じ edit モード判定で `data-editable-content="{kind}:{id}:cover"` を条件付き出力。
- 施工事例詳細のギャラリー画像 (work_images): `data-editable-work-image="{work_id}:{media_id}"` を edit モード時のみ出力。**さらに `data-editable-work-image-sort={sort_order}` を付与** して置換時の順序維持に使う。
- 固定 40 箇所の `<Image src="/img/..">` を `<SlotImage slotKey="..">` に置換。resolved はページの Server Component が `resolvePageMedia()` を呼び、必要な slot だけ props で子へ渡す (RSC のシンプルな props バケット)。
- **hero**: トップの `/hero.jpg` を `SlotImage slotKey="home.hero"` に。hero テキスト部は settings.hero のまま (BLOCKER-1 で media_id は除去済み)。
- **未来枠 4 種**: story.portrait / shop.product.1-3 の COMING SOON 位置に SlotImage を追加。default なし → 未設定時はプレースホルダ (edit モードでもクリック可能)。

### 4.3 不変条件
- SlotImage 未設定時の見た目 = 現状の固定画像と同一 (default_src が現 src)。**移行しても公開サイトは一切変わらない**。
- aspect/sizes/priority は registry 由来でコンポーネント固定。src/alt のみ可変。
- **公開閲覧では data-editable-* を一切出さない (MAJOR-4)**。edit モードは admin セッション + `?__edit=1` の同時成立時のみ。cookie が無い or `__edit` が無ければ通常表示。

---

## 5. ビジュアルエディタ `/admin/visual`

### 5.1 構成
```
[ページ選択タブ: トップ/会社案内/サービス/…]  ← registry の page 一覧
┌─────────────────────────────────────┐  ┌─────────────────┐
│  <iframe src="{route}?__edit=1">    │  │ 空スロット一覧   │  ← BLOCKER-3
│    実物ページを縮小表示 (同一オリジン) │  │ (このページで写真が│    対応
│    親が data-editable-* から座標取得 │  │  無いカードの一覧) │
│    → ホットスポット重畳 → クリックで│  │ クリックで         │
│      メニュー: 変更/alt/既定に戻す   │  │ MediaPicker → 保存 │
└─────────────────────────────────────┘  └─────────────────┘
```

### 5.2 動作シーケンス
```
1. /admin/visual (admin gated) で page を選択
   → iframe URL に ?__edit=1 を付与し、cookie に edit-token を発行してから load
2. iframe onload + iframe 内 DOMContentLoaded + Reveal アニメ終了イベント (custom event)
   の 3 種すべてを待って初回測定 (MAJOR-6 対応)
3. 親が iframe.contentDocument から [data-editable-slot] /
   [data-editable-content] / [data-editable-work-image] 要素の getBoundingClientRect()
   を取得しホットスポット描画。iframe rect + 内側 rect + scroll + scale 合成で親座標系へ写像
4. 追従: iframe 内 window の scroll + resize、iframe 自身の ResizeObserver、
   各画像の img.onload (lazy 遅延読み込み後の再測定)、Reveal 動作完了、
   requestAnimationFrame ループでスクロール中の粘着追従
5. ホットスポット click → 小メニュー (画像を変更 / alt 編集 / 既定に戻す)
6. 「画像を変更」→ MediaPicker (単一選択、汎用ラベルに MINOR-3 対応)
7. Server Action で保存 (§6 参照)
8. 保存後: revalidatePath(route) + revalidateTag('page_media') → iframe.contentWindow.location.reload()
   で反映を即確認 (MAJOR-3 対応)
```

### 5.3 セキュリティモデル (MAJOR-v1.2 で正確化)
- **通常の公開閲覧では data-editable-* を出さない** (§4.2)。**表現の厳密化**: 「公開ページの HTML に data 属性が出るのは admin cookie 保持者が `?__edit=1` を付けてアクセスしたときのみ」。それ以外の匿名アクセスや admin cookie のみ (URL に `?__edit=1` なし) の閲覧では出ない。「匿名閲覧者に一切露出しない」は成立するが、**admin 自身が誤って `?__edit=1` 付き URL を第三者に共有すればその 1 リクエストの HTML には出る**点を運用注意として明記。

- **edit cookie の厳密仕様**:
  - 名前: `kmb-edit-token`
  - 値: 32 バイト rand + admin user_id を HMAC-SHA256 で署名した文字列
  - 属性: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1800` (30 分の短命)
  - 発行: `/admin/visual` を admin セッションで開いた瞬間の Server Component で `cookies().set(...)` (30 分ごとにローテーション)
  - 検証: SlotImage の Server Component で `cookies().get('kmb-edit-token')` → HMAC 検証 → 現行 admin セッションの user_id と一致 → edit モード有効
  - 破棄: `/admin/visual` から離れる Server Action で `cookies().delete()` (idle でも 30 分で自然失効)

- **cache 分離**: edit モードは URL に `?__edit=1` が付くため、Next.js の Route Cache キーが自然に別になる (query が cache key の一部)。無印 URL と `?__edit=1` は別エントリ扱いになり、admin が edit モードで見た HTML が公開キャッシュに漏れない。
  - 補助として SlotImage の親 Server Component で edit モード時は `unstable_noStore()` を呼び、Route Cache を明示的に無効化する。

- 脅威モデル:
  - 攻撃者が `?__edit=1` を付けてもトークンがなければ通常表示 (Server 判定でスキップ)。
  - トークン推測は 32 バイト rand + HMAC で計算的に不可能。
  - iframe 内で任意 JS を実行させない (親が DOM 座標を読むだけ)。
  - 保存の最終防御は RLS。data 属性の値を偽装しても write は admin RLS で拒否。
- CSP: `/admin/visual` は `frame-ancestors 'self'` のみ許可。iframe に読ませる公開ルートは通常の CSP (公開閲覧と同じ)。

### 5.4 空スロット可視化 (BLOCKER-3 対応)
- iframe クリックだけに頼らない。**サイドパネル**に「そのページ (route) が持つべき全 slot」を registry から一覧し、resolveAll の結果と突き合わせて `state = default | custom | placeholder | 未使用DOM` を各行に表示。
- 対象:
  - コンテンツ画像側で null (`voices.photo=null` の声 / `posts.cover=null` の記事) → 公開ページに DOM が出ないので iframe 内には映らない。サイドパネルからだけ設定できる。
  - `story.portrait` / `shop.product.*` (未来枠) → プレースホルダ DOM は出るが、サイドパネルにも重複掲載して確実にたどれるように。
- サイドパネル行をクリック → 対応する DOM が iframe にあればスクロールしてハイライト、無ければ直接 MediaPicker を開く。

### 5.5b 保存境界と cache 失効の順序 (MAJOR-v1.2 対応)

Server Action の実装契約:
1. Zod parse → 権限確認 (requireAdmin)
2. **DB commit まで完了** (page_media upsert / ContentFacade 経由の works/voices/posts 更新 / work_images RPC の atomic 更新)
3. **revalidate を await で完了させてから 200 応答**:
   - ページスロット保存: `revalidatePath(route)` + `revalidateTag("page_media")`
   - works.cover / work_images 保存: `revalidatePath("/works/[slug]", "page")` + `revalidatePath(route)` + `revalidateTag("works")`
   - voices.photo 保存: `revalidatePath("/voices")` + `revalidateTag("voices")`
   - posts.cover 保存: `revalidatePath("/notes/[slug]", "page")` + `revalidatePath("/notes")` + `revalidatePath("/blog/[slug]", "page")` + `revalidatePath("/blog")` + `revalidateTag("posts:reading")` + `revalidateTag("posts:blog")` + `revalidateTag("posts:news")`
4. Server Action の Result を返却 → **クライアントは 200 を受け取ってから** `iframe.contentWindow.location.reload()` を呼ぶ (revalidate 完了保証のため順序が重要)。

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
  resolveAll(): Promise<Result<Map<string, ResolvedSlot>>>; // 公開 SSR 用 (rpc_get_page_media_all)
  listForAdmin(route?: string): Promise<Result<Array<PageSlotState>>>; // route 絞り込み可能
  setSlot(slotKey: string, mediaId: string | null): Promise<Result<void>>;
  setSlotAlt(slotKey: string, alt: string | null): Promise<Result<void>>;
}

// ContentFacade への追加 (BLOCKER-2 / MAJOR-v1.2 対応):
//   setWorkCover(workId, mediaId|null)
//   setVoicePhoto(voiceId, mediaId|null)
//   setPostCover(postId, mediaId|null)
//   setWorkImage(workId, oldMediaId, newMediaId|null)
//     ← work_images ギャラリー 1 行の置換。以下の atomic RPC を呼ぶ (§7 の replace_work_image)
//   楽観排他: 上位の works/voices/posts の updated_at 込みで既存踏襲
```

Zod 契約 (`page-media/contracts.ts`):
- `zSetSlotReq { slot_key: registry のキーに限定, media_id: uuid|null }`
- `zSetSlotAltReq { slot_key, alt: string|null (max 200) }`

ContentFacade 側の追加 Zod (`content/contracts.ts`):
- `zSetWorkImageReq { work_id: uuid, old_media_id: uuid, new_media_id: uuid|null }`

Server Action シグネチャ (`src/app/admin/visual/actions.ts`):
- `setImage(target: EditableTarget, mediaId: string|null)` — `EditableTarget` は discriminated union で slot/content/work-image を判別

---

## 6.1 work_images 置換の atomic 契約 (MAJOR-v1.2 対応)

`data-editable-work-image-sort` はクライアント値のため信用しない。**sort_order は Server で読み直して維持**する。以下の RPC を migration 0013 で追加し、setWorkImage はこの RPC のみを呼ぶ:

```sql
create or replace function public.replace_work_image(
  p_work_id uuid,
  p_old_media_id uuid,
  p_new_media_id uuid   -- null は「削除」
)
returns void
language plpgsql
security invoker  -- admin RLS を適用する (worker が呼ぶ場合も admin セッションで)
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
    raise exception 'KMB-E404: work_images(%, %) not found', p_work_id, p_old_media_id;
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
end;
$$;

revoke execute on function public.replace_work_image(uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_work_image(uuid, uuid, uuid) to authenticated;
-- 実行は admin セッションを想定。RLS は work_images への is_admin() 書き込みポリシー (migration 0012) で担保。
```

エラー扱い:
- 対象行なし → **KMB-E404** (画面リロードで最新化を促す)。
- new_media_id が同一 work に既存 → **KMB-E108** (新設、下記)。
- insert 失敗のその他 → 例外がそのままトランザクションを rollback。

Zod (`content/contracts.ts`):
```ts
export const zSetWorkImageReq = z.object({
  work_id: z.string().uuid(),
  old_media_id: z.string().uuid(),
  new_media_id: z.string().uuid().nullable(),
}).strict();
```

## 7. エラーコード (追加)
| コード | 意味 | 復旧 |
|---|---|---|
| KMB-E107 | 未知の slot_key (registry 外) | 再読み込み。registry と DB の整合を確認 |
| KMB-E108 | work_images 追加時に同一 work に同 media が既存 | 別の画像を選ぶか、既存画像を先に削除 |
| KMB-E404 | 対象行/コンテンツが見つからない (置換対象など) | 画面再読み込みで最新化 |
| (E301 拡張) | page_media 参照中 media の削除 | 参照元 (ページ名) を提示 |

---

## 8. テスト戦略
| レイヤ | 対象 |
|---|---|
| 単体 | registry の一意性/route 妥当性、resolver の fallback (media/null/未登録)、zSetSlotReq の slot_key 検証 |
| 結合 | page_media RLS (anon select / admin write)、setSlot upsert + 既定復帰、E301 に page_media 参照が効く |
| E2E (実ブラウザ) | /admin/visual で iframe ロード → ホットスポット表示 → クリック → MediaPicker → 差し替え → iframe reload で反映 → 公開ルートで実データ反映。**キーボード**: メニューの Tab/Enter/Esc。空スロット (未来枠) の設定。既定に戻す |
| 非影響 | SlotImage 導入後、未設定状態の公開ページが移行前とスナップショット一致 (見た目不変) |

---

## 9. フェーズ分割 (1 セッション一括、wave 並列)
| wave | 内容 | 並列 | 依存 |
|---|---|---|---|
| V1 | page_media DDL (0013) + registry + seed + resolver + facade + Zod。E301/view 拡張 | 単独 | — |
| V2a | 公開ページ: SlotImage / PhotoFigure / MediaCover の data 属性化 + 固定 40 枚置換 + hero 接続 + 未来枠 4 スロット追加 | 並列 (ページ群で分割可) | V1 |
| V2b | /admin/visual エディタ (iframe overlay + ホットスポット + メニュー + MediaPicker 連携 + Server Actions) | 並列 | V1 (data 属性の契約だけ先に固定) |
| V3 | 統合 + Codex レビュー + 実機 E2E (実ブラウザで差し替え→反映) + 見た目非影響スナップショット | 単独 | V2a+V2b |

- V2a はページ数が多いので implementer 複数 + worktree 分離。data 属性の命名規約 (§1) を先に確定して各 implementer に渡す。
- 実装は全て worktree 分離 (main 直接作業の共有ツリー事故を回避)。

---

## 10. 非機能・移行
- 移行: seed で page_media は**空**でよい(未設定 = 既定画像)。既存の見た目を維持したまま、堀さんがエディタで 1 枚ずつ実写に差し替えていく運用。
- 性能: resolvePageMedia は 1 クエリ + タグキャッシュ。ページ描画への追加コスト最小。
- 既存 `site_settings.hero.media_id` は 0013 で削除 (page_media.home.hero へ一本化)。hero テキストは settings 継続。seo_defaults.og_media_id の接続は本 Phase 対象外 (別途)。
- MINOR: `/admin/visual` を admin nav-items.ts に追加。MediaPicker のヘッダー文言を「画像を選ぶ」に汎用化 (works/posts の「カバー画像」ラベルは呼び出し側 props で上書き)。

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

## 12. 更新履歴
| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-07-08 | 初版 |
| v1.1 | 2026-07-09 | Codex 外部レビュー 12 件反映 (BLOCKER 3 / MAJOR 8 / MINOR 1) |
| v1.2 | 2026-07-09 | Codex 再レビュー 6 件反映 (BLOCKER 1 / MAJOR 4 / MINOR 1)。実装 GO 判断待ち |
