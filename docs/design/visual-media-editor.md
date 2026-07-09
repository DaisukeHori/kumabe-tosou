# ビジュアル画像エディタ 設計書

- 版: v1.0
- 作成日: 2026-07-08
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
| **ページスロット** | 固定 40 枚 + hero + 新規枠 (story.portrait / shop.product) | `data-editable-slot="home.hero"` | `page_media` テーブル (§2) |
| **コンテンツ画像** | works.cover / work_images / voices.photo / posts.cover | `data-editable-content="work:{uuid}:cover"` 等 | 既存コンテンツテーブルの media FK |

- ページスロット: 装飾/ヒーロー等、コンテンツに紐付かない「ページの見た目」の写真。
- コンテンツ画像: 施工事例・声・記事の実データ写真。ビジュアルエディタからも差し替え可能だが、保存は既存の ContentFacade 経由(works.cover_media_id 等)。
- **hero**: `home.hero` を page_media スロットとして扱う(画像のみ)。hero の見出し/CTA テキストは従来どおり `site_settings.hero`。→ 画像編集の入口を全ページで統一。

---

## 2. データモデル (canonical DDL)

```sql
-- ページの装飾/ヒーロー画像スロット。slot_key はコード側の registry (§3) が正。
create table page_media (
  slot_key text primary key,          -- 'home.hero' | 'home.craft.1' 等 (§3 registry と 1:1)
  media_id uuid references media(id),  -- null = 既定画像 (default_src) を使用
  alt_override text,                   -- null = registry の alt_default
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
-- default_src / page / section_label / aspect / sort_order 等の静的メタは DB に持たず
-- コード側の SLOT_REGISTRY (§3) が単一ソース。page_media は「差し替えられた分」だけを保持する。
-- 未登録 slot_key の行が無くても resolver は registry の default_src にフォールバックする。

create trigger handle_updated_at before update on page_media
  for each row execute procedure extensions.moddatetime (updated_at);

alter table page_media enable row level security;
-- anon: 公開ページの SSR が anon client で読むため SELECT 許可
create policy page_media_anon_select on page_media for select using (true);
create policy page_media_admin_insert on page_media for insert with check (public.is_admin());
create policy page_media_admin_update on page_media for update using (public.is_admin()) with check (public.is_admin());
create policy page_media_admin_delete on page_media for delete using (public.is_admin());
```

`page_media` は **差分のみ保持**(upsert)。「既定に戻す」= その行を削除 or media_id=null。DDL 追加テーブルは 1 (page_media)。migration 連番は既存の続き (0013)。

### 2.1 全データパターン
| パターン | 挙動 |
|---|---|
| slot 行なし | registry の default_src を表示 (移行前・既定状態) |
| media_id 設定 | media レンディション webp URL を表示 |
| media_id=null (行あり) | default_src にフォールバック (= 既定に戻す) |
| 参照 media 削除 | media_admin_delete の参照ゼロ判定に page_media も含める (§5 で E301 拡張) |
| 未来スロット (story.portrait 等) の default なし | 「NO IMAGE / 画像を設定」プレースホルダ表示 (MediaCover 準拠) |

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

### 4.1 リゾルバ
`resolvePageMedia(): Promise<Map<slotKey, {src, alt}>>` (SSR, anon client, `unstable_cache` tag `page_media`)。全 page_media 行を 1 回取得 → registry と突き合わせ → 各 slot の表示 src/alt を確定 (media_id→レンディション URL / null→default_src)。

### 4.2 画像コンポーネント
- 新規 `SlotImage`(`src/components/site/slot-image.tsx`): props `slotKey` + resolved map (context 経由)。registry から aspect/sizes/priority を引き、`<Image>` を描画。**常に `data-editable-slot={slotKey}` と `data-editable-media={mediaId ?? ''}` を出力**(通常表示に影響なし)。
- `PhotoFigure`(`page-blocks.tsx`): 内部 `<Image>` を SlotImage 対応に(slotKey を受け取れるよう拡張。キャプション装飾は維持)。
- `MediaCover`(works/voices/posts): `data-editable-content="{kind}:{id}:{field}"` を出力するよう拡張。表示挙動は不変。
- 固定 40 箇所の `<Image src="/img/..">` を `<SlotImage slotKey="..">` に置換(棚卸し表の対応で機械的に)。
- **hero**: トップの `/hero.jpg` を `SlotImage slotKey="home.hero"` に。hero テキストは settings.hero のまま。
- **未来枠 2 種**: story.portrait / shop.product の COMING SOON プレースホルダ位置に SlotImage を追加(default なし → 未設定時はプレースホルダ、設定で写真)。

### 4.3 不変条件
- SlotImage 未設定時の見た目 = 現状の固定画像と同一(default_src が現 src)。**移行しても公開サイトは一切変わらない**。
- aspect/sizes/priority は registry 由来でコンポーネント固定。src/alt のみ可変。
- blog/notes 詳細の「cover 無ければ枠非表示」の非対称は現状維持(エディタ側は空枠にも設定導線を出す、§5)。

---

## 5. ビジュアルエディタ `/admin/visual`

### 5.1 構成
```
[ページ選択タブ: トップ/会社案内/サービス/…]  ← registry の page 一覧
┌───────────────────────────────────────────────┐
│  <iframe src="{route}">  実物ページを縮小表示     │  ← 同一オリジン
│    (親が iframe の DOM から data-editable-* を    │
│     読み、各画像の上にホットスポットを重畳)        │
│   クリック → メニュー: [画像を変更][alt編集][既定に戻す]│
│     「画像を変更」→ 既存 MediaPicker ダイアログ    │
└───────────────────────────────────────────────┘
```

### 5.2 動作シーケンス
```
1. /admin/visual (admin gated) で page を選択 → iframe に実ルートをロード
2. iframe load 後、親が iframe.contentDocument から [data-editable-slot] /
   [data-editable-content] 要素の getBoundingClientRect() を取得しホットスポット描画
   (iframe スクロール/リサイズに追従。ResizeObserver + scroll 監視)
3. ホットスポット click → 小メニュー (画像を変更 / alt 編集 / 既定に戻す)
4. 「画像を変更」→ MediaPicker (単一選択) → 選択 mediaId
5. Server Action:
   - slot: setSlotMedia(slotKey, mediaId|null)  → page_media upsert + revalidateTag('page_media') + 対象 route の revalidate
   - content: setContentImage(kind, id, field, mediaId|null) → ContentFacade 経由 (works.cover 等) + revalidateTag(kind)
6. iframe.location.reload() で反映を即確認
```

### 5.3 セキュリティ
- **公開ページに編集モードは実装しない**。SlotImage/MediaCover は data 属性を常時出すだけ(無害)。ホットスポット overlay は `/admin/visual`(admin 認証済み)内にのみ存在。
- iframe は同一オリジンのため親が DOM 参照可。iframe 内で任意 JS 実行はしない(読み取りと reload のみ)。
- 保存はすべて admin Server Action + RLS(page_media / content の admin-write)。仮にホットスポットを偽装しても RLS で拒否。
- iframe に `?__preview=1` 等のクエリは不要(通常ページをそのまま読む)。CSP/frame-ancestors は同一オリジンのみ許可。

### 5.4 メディア削除ガード拡張 (E301)
`media_admin_delete` RLS と `media_reference_summary` view の参照カウントに **page_media.media_id を追加**(migration 0013 で view を更新)。ビジュアルエディタで使用中の画像は削除不可に。

---

## 6. facade / 契約

```ts
// src/modules/page-media/facade.ts
export interface PageMediaFacade {
  resolveAll(): Promise<Result<Map<string, { src: string; alt: string }>>>; // 公開 SSR 用 (anon)
  listForAdmin(): Promise<Result<Array<PageSlotState>>>;   // registry + 現状態 (admin)
  setSlot(slotKey: string, mediaId: string | null): Promise<Result<void>>;
  setSlotAlt(slotKey: string, alt: string | null): Promise<Result<void>>;
}
// content 画像の差し替えは既存 ContentFacade に薄いメソッド追加:
//   setWorkCover / setVoicePhoto / setPostCover (mediaId|null) — 楽観排他は updated_at で既存踏襲
```

Zod 契約 (`page-media/contracts.ts`): `zSetSlotReq { slot_key: string(registry のキーに限定), media_id: uuid|null }`。slot_key は registry 由来の enum 相当で検証。

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
- 既存 `site_settings.hero` の image は home.hero スロットへ集約(hero テキストは settings 継続)。seo_defaults.og_media_id の接続は本 Phase 対象外 (別途)。
