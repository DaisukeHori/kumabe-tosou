# ビジュアル画像エディタ 設計書

- 版: v1.1 (Codex 外部レビュー 12 件反映)
- 作成日: 2026-07-08 (v1.0) → 2026-07-09 (v1.1)
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
-- MINOR-2 対応: anon SELECT は必要列だけの public view で公開し、updated_by は隠す
-- (RLS で anon が全行 SELECT できるが、view から updated_by を除外して露出を抑える)
create policy page_media_admin_select on page_media for select using (public.is_admin());
create policy page_media_admin_insert on page_media for insert with check (public.is_admin());
create policy page_media_admin_update on page_media for update using (public.is_admin()) with check (public.is_admin());
create policy page_media_admin_delete on page_media for delete using (public.is_admin());

create or replace view public.page_media_public
with (security_invoker = true) as
  select slot_key, media_id, alt_override, updated_at from page_media;

-- 公開 SSR (anon) 用: view には RLS が働かない (security_invoker) ため、
-- 元テーブルのポリシーを回避する目的で view SELECT を anon にも許可する
grant select on public.page_media_public to anon, authenticated;
-- ※ view は security_invoker=true のため、anon で呼ぶと page_media 本体の
--    SELECT ポリシー (admin のみ) に阻まれる。resolver は SECURITY DEFINER の
--    RPC 経由で読み出す (下記 rpc_get_page_media_all)。
create or replace function public.rpc_get_page_media_all()
returns setof public.page_media_public
language sql
security definer
stable
set search_path = public
as $$
  select slot_key, media_id, alt_override, updated_at from page_media
$$;
grant execute on function public.rpc_get_page_media_all() to anon, authenticated;

-- BLOCKER-1 対応: site_settings の hero.media_id を廃止 (テキストのみに縮退)。
-- 既存行があれば value から media_id を除去。
update site_settings
   set value = value - 'media_id'
 where key = 'hero'
   and value ? 'media_id';
```

`page_media` は **差分のみ保持**(upsert)。「既定に戻す」= その行を削除 or media_id=null。DDL 追加テーブルは 1 (page_media) + 1 view (page_media_public) + 1 RPC (rpc_get_page_media_all)。migration 連番は既存の続き (0013)。

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
export const SLOT_REGISTRY: readonly PageSlot[] = [ /* 棚卸し §固定画像一覧の 40 + hero + 2 未来枠 */ ];
```

登録スロット (棚卸しより): home.hero / home.craft.1-3 / home.gallery.1-3 / about.facility.1-3 / about.gallery.1-2 / colors.hero / colors.band.1-3 / contact.hero / materials.methods.1-2 / materials.gallery.1-2 / process.steps.1-3 / process.gallery.1-3 / service.process.1-2 / service.gallery.1-2 / story.chapter.1-5 / shop.hero / shop.grade.1-3 / **story.portrait (新規)** / **shop.product.1-3 (新規)**。計 40 + 4 = 約 44 スロット。

---

## 4. 公開ページ側の実装

### 4.1 リゾルバ (MAJOR-2/MAJOR-5 対応)
`resolvePageMedia(): Promise<Map<slotKey, ResolvedSlot>>` (SSR, anon client, `unstable_cache` tag `page_media`)。

```ts
type ResolvedSlot = {
  src: string | null;      // null = プレースホルダ表示 (未来枠かつ未設定)
  alt: string;
  mediaId: string | null;  // null = 既定 / 未設定
  isDefault: boolean;      // true = registry の default_src が使われている
  source: "page_media" | "default" | "placeholder";
};
```

- `unstable_cache` の keyParts に `["page_media", REGISTRY_HASH]` を入れる (`REGISTRY_HASH` は build 時に registry の JSON 内容を sha1 で計算した定数)。**registry のコード変更がキャッシュに残らない**ようにする。
- 保存後の反映は `revalidatePath(route)` (対象ページのみ) + `revalidateTag("page_media")` (使用箇所横断のフォールバック) の両方を行う。iframe 側は保存成功後に `iframe.contentWindow.location.reload()` で確実に最新を取得。
- 実装は 1 クエリで全行取得 → registry を走査してマップ生成。エラー時は全 slot を `isDefault=true` で返し、公開ページが落ちない。

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

### 5.3 セキュリティモデル (MAJOR-4 明確化)
- **通常の公開閲覧では data-editable-* を出さない** (§4.2)。slot 構造・media_id・content UUID は匿名閲覧者に一切露出しない。
- edit モードの成立条件は AND で 2 つ: (a) admin セッションの edit-token cookie 有効、(b) URL に `?__edit=1`。両方揃わないと data 属性は出ない。
- 脅威モデル:
  - 攻撃者が `?__edit=1` を付けてもトークンがなければ通常表示。
  - cookie を持つ admin 自身が iframe 内で悪意ある JS を混入させる余地はない (同一オリジンだが iframe 内で任意 JS を実行させない = 親が読むだけ)。
  - 保存の最終防御は RLS。data 属性の値を偽装しても write は admin RLS で拒否。
- CSP: `/admin/visual` は `frame-ancestors 'self'` のみ許可。iframe に読ませる公開ルートは通常の CSP (公開閲覧と同じ)。

### 5.4 空スロット可視化 (BLOCKER-3 対応)
- iframe クリックだけに頼らない。**サイドパネル**に「そのページ (route) が持つべき全 slot」を registry から一覧し、resolveAll の結果と突き合わせて `state = default | custom | placeholder | 未使用DOM` を各行に表示。
- 対象:
  - コンテンツ画像側で null (`voices.photo=null` の声 / `posts.cover=null` の記事) → 公開ページに DOM が出ないので iframe 内には映らない。サイドパネルからだけ設定できる。
  - `story.portrait` / `shop.product.*` (未来枠) → プレースホルダ DOM は出るが、サイドパネルにも重複掲載して確実にたどれるように。
- サイドパネル行をクリック → 対応する DOM が iframe にあればスクロールしてハイライト、無ければ直接 MediaPicker を開く。

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

// ContentFacade への追加 (BLOCKER-2 対応):
//   setWorkCover(workId, mediaId|null)
//   setVoicePhoto(voiceId, mediaId|null)
//   setPostCover(postId, mediaId|null)
//   setWorkImage(workId, oldMediaId, newMediaId|null) ← work_images ギャラリー 1 行の置換
//     newMediaId=null は「その 1 行を削除」。sort_order は元の行の値を維持。
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

## 7. エラーコード (追加)
| コード | 意味 | 復旧 |
|---|---|---|
| KMB-E107 | 未知の slot_key (registry 外) | 再読み込み。registry と DB の整合を確認 |
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
| V2a | 公開ページ: SlotImage / PhotoFigure / MediaCover の data 属性化 + 固定 40 枚置換 + hero 接続 + 未来枠 2 種追加 | 並列 (ページ群で分割可) | V1 |
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

## 12. 更新履歴
| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-07-08 | 初版 |
| v1.1 | 2026-07-09 | Codex 外部レビュー 12 件反映 (BLOCKER 3 / MAJOR 8 / MINOR 1) |
