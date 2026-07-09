# ビジュアルテキストエディタ 設計書

- 版: v1.1 (Codex レビュー BLOCKER 0 / MAJOR 5 / MINOR 3 を反映。実装 GO)
- 作成日: 2026-07-10
- 作成: メインセッション直接執筆 (Fable 5)
- 親設計: [visual-media-editor.md](./visual-media-editor.md) — **機構 (resolver 契約 / /edit ルート / ホットスポット / 保存境界 / RLS 方針) を全面再利用**する。本書は差分のみ規定し、記述が無い事項は親設計に従う
- 入力資料: [text-slots/PLAN.md](./text-slots/PLAN.md) — **Tier A 75 スロットの確定表・命名規約・max_len が canonical**。本書と食い違う場合は PLAN.md §3 が正

## 0. 目的とスコープ

公開ページのハードコードされた「言葉」(見出し・リード・CTA 文言) を、ビジュアルエディタ (/admin/visual) 上でクリック → その場で書き換え・既定復帰できるようにする。

- **v1 対象 = Tier A 74 スロット** (PLAN.md §3.2 の 75 件から、実装時の実測で `story.message.body` がインライン装飾 `<strong>` を含むと判明し PLAN.md 自身の退避条項に従い Tier B へ差し戻し。DB 由来テキスト (works/posts/voices、site_settings) は対象外 — 既存フォームが正
- スコープ外: Tier B (段落本文・リッチテキスト・story 章のセット編集)、home hero CTA 3 連 (site_settings.hero と二重管理になるため、解決は v2)、インライン装飾 (`<strong>` 等) を含むテキスト

## 1. データモデル (migration 0014)

```sql
-- page_media (0013) と対称。差分のみ保持、行なし = registry の defaultText。
create table page_text (
  slot_key text primary key,           -- TEXT_REGISTRY (§2) と 1:1
  text_override text not null,         -- null 概念は「行削除 = 既定に戻す」で表現するため not null
  updated_at timestamptz not null default now()
);

create trigger handle_updated_at before update on page_text
  for each row execute procedure extensions.moddatetime (updated_at);

alter table page_text enable row level security;

create policy page_text_anon_select on page_text for select using (true);
create policy page_text_admin_insert on page_text for insert with check (public.is_admin());
create policy page_text_admin_update on page_text for update using (public.is_admin()) with check (public.is_admin());
create policy page_text_admin_delete on page_text for delete using (public.is_admin());

grant select on page_text to anon, authenticated;
grant insert, update, delete on page_text to authenticated;
```

- **view は作らない** (page_media_resolved は media join のために存在した。page_text は join 相手が無く、素の 1 SELECT で足りる)
- anon SELECT 許可の割り切りは親設計 §2 (BLOCKER-v1.3) と同一の判断: 全列が公開 HTML に出る公開メタデータ
- 「既定に戻す」= 行削除 (upsert/delete の 2 操作のみ。page_media の media_id=null 相当の中間状態は持たない — テキストに「null で既定」の意味論は不要なため単純化)

## 2. TEXT_REGISTRY (コード canonical)

`src/modules/page-media/text-registry.ts` に定義。**page-media モジュールに同居**させる (§7 モジュール裁定)。

```ts
export type TextKind = "text" | "lines" | "multiline";
// text      = 単一行 (改行禁止)
// lines     = 改行 (\n) 埋め込み見出し。表示側が行分割レンダー
// multiline = 段落テキスト (\n\n 区切り可)

export type PageTextSlot = {
  key: string;          // 'home.statement.heading' (PLAN.md §1 命名規約)
  page: string;
  route: string;        // EDITABLE_ROUTES と同体系
  label: string;        // 管理画面表示用
  kind: TextKind;
  maxLen: number;       // PLAN.md の確定値。書記素クラスタ数ではなく string.length で判定 (Zod と同基準)
  maxLines?: number;    // kind=lines/multiline の行数上限 (MAJOR-2。lines は必須 — 過剰改行での崩れ防止)
  maxLineLen?: number;  // lines の 1 行あたり上限 (未指定は maxLen/maxLines の floor を既定に)
  affectedRoutes?: string[];      // route 以外に失効させる path (例 notes.cta.* → ["/notes", "/notes/[slug]"])
  affectsAllRoutes?: boolean;     // shared.* / chrome.* 用。全静的 route + 動的 3 パターン ("page") を失効
  defaultText: string;  // 現行ハードコード文言そのまま (V2a 画像と同じ「見た目非退行」の正)
};
export const TEXT_REGISTRY: readonly PageTextSlot[] = [ /* 74 件 (PLAN.md §3.2 − story.message.body) */ ];
export const TEXT_REGISTRY_HASH = /* registry JSON の sha1 (page_media と同方式) */;
```

- 実装時、defaultText は**各 page-body の現行文言から機械的に転記**し、単体テストで「PLAN.md の件数 75 と一致」「key 重複なし」「route が EDITABLE_ROUTES に含まれる」を強制
- `shared.cta.consult` (route 横断の共有スロット) は route = "/" とし、SiteHeader / SiteFooter / CtaBand が同一スロットを参照 (単一ソース化、PLAN.md §2.2)

## 3. resolver / facade (page-media facade へ追加)

```ts
// 追加メソッド (PageMediaFacade)
resolveAllTexts(): Promise<Result<ResolvedTexts>>;      // 公開 SSR: unstable_cache tag "page_text", keyParts ["page_text", TEXT_REGISTRY_HASH]
resolveAllTextsFresh(): Promise<Result<ResolvedTexts>>; // /edit 用 (キャッシュ非経由)
listTextsForAdmin(route?: string): Promise<Result<PageTextState[]>>;
setText(slotKey: string, text: string | null): Promise<Result<void>>; // null = 既定に戻す (行削除)。**text === defaultText の保存も delete に正規化** (差分のみ保持と isDefault 表示の一貫性、MINOR)

type ResolvedText = { text: string; isDefault: boolean }; // JSON-safe。Map 禁止 (親設計 BLOCKER-v1.4 と同一不変条件)
type ResolvedTexts = Record<string, ResolvedText>;
```

- resolver はエラー時に全 slot を defaultText で返す (公開ページを落とさない — 親設計 §4.1 と同じ)
- 検証: registry 外 slot_key → KMB-E107 / maxLen 超過・kind 違反 (text に改行等) → KMB-E101

## 4. 公開ページ側

### 4.1 SlotText コンポーネント (`src/components/site/slot-text.tsx`)

```ts
type SlotTextProps = {
  slotKey: string;
  resolved: ResolvedText;
  editMode: boolean;
  as?: keyof JSX.IntrinsicElements;   // 既定 span。見出しは呼び出し側が h1 等を包むか as で指定
  className?: string;
  renderLines?: (lines: string[]) => ReactNode; // kind=lines 用。行ごとの装飾 (kt-hero-line / text-soul 最終行等) は呼び出し側が保持
};
```

- テキストは React の通常レンダリング (エスケープ標準)。**dangerouslySetInnerHTML 禁止**
- editMode=true のときのみ `data-editable-text={slotKey}` を出力 (editable-attrs.ts に `textEditableAttrs()` を追加 — editMode=false で `{}` を返す既存の構造的保証と同型)
- kind=lines: resolved.text を `\n` で分割し renderLines へ。renderLines 未指定なら `<br/>` 結合
- **kind=multiline は root が必ず `div`** (`as` は無視) で内部に `<p>` 群を生成 — `as="p"` と組み合わせた `<p><p>` の不正 HTML を構造的に禁止 (MAJOR-4)
- **SplitChars (home ヒーロー文字分割) との共存**: data 属性は分割前の親要素 (SlotText のルート) に付く。SplitChars には resolved.text を渡す (編集後の文言も 1 文字ずつリビールされる)。multiline の段落は `\n\n` split で `<p>` 群
- 呼び出し側 page-body は `texts["home.craft.heading"]` を props バケツ (ResolvedTexts) から引く — 画像の slots と並ぶ第 2 バケツ `texts` を Body props に追加
- **共有/chrome スロットの配線 (MAJOR-1)**: `shared.cta.consult` / `chrome.*` は SiteHeader/SiteFooter (layout 側) に出るため page-body 経由では届かない。**(site)/layout.tsx が `resolveAllTexts()`、(editor)/layout.tsx が `resolveAllTextsFresh()` を呼び、SiteHeader/SiteFooter に該当 resolved + editMode を props で渡す** (site=false / editor=true)。unstable_cache は request-time API ではないため (site) layout の SSG を壊さない

### 4.2 不変条件 (親設計 §4.3 の拡張)
- page_text が空 (初期状態) のとき、公開ページのレンダリング結果は**現行と 1 文字も変わらない** (defaultText = 現行文言の転記を単体テストで担保)
- 公開 (site) ルートは editMode=false 固定・request-time API なし・SSG 維持 — すべて既存と同じ

## 5. エディタ側 (/admin/visual 拡張)

- visual-editor の走査対象に `[data-editable-text]` を追加。**テキストホットスポットは青系** (画像 = 赤系 primary と視覚区別)
- **hotspot id は `text:${slotKey}:${ordinal}`** (同一ページに同一 slotKey が複数出る shared.cta.consult 対応。保存 target の slotKey と DOM 個体 id を分離する、MAJOR-5)。`getBoundingClientRect()` が zero rect (非表示要素) のものは除外
- クリック → テキスト編集メニュー (HotspotMenu の亜種):
  - kind=text → `<Input>` / lines・multiline → `<Textarea>` (rows は kind と現行行数から)
  - 文字数カウンタ (`{len}/{maxLen}`)、超過時は保存ボタン無効 + 赤字
  - kind=text は改行入力を禁止 (Enter で保存)
  - ボタン: 保存 / 既定に戻す (isDefault=false のときのみ) / キャンセル (Esc、フォーカス復帰は既存機構)
- Server Action `setSlotText(slotKey, text | null)`: Zod parse (registry 限定 + maxLen/maxLines/maxLineLen + kind 検証) → requireAdmin → facade.setText → **commit 後 return 前に** 失効 (MAJOR-2):
  - 基本: `revalidatePath(slot.route)` + `revalidateTag("page_text")`
  - `affectedRoutes` があれば各 path も失効 (動的パターンは `revalidatePath("/notes/[slug]", "page")` 形式)
  - `affectsAllRoutes` (shared.*/chrome.*) は EDITABLE_ROUTES の全静的 route + `works/notes/blog の [slug] 3 パターン ("page")` を失効
- サイドパネル: 既存のスロット一覧に「テキスト」セクションを追加 (listTextsForAdmin、state = default | custom)。行クリックで iframe 内該当要素へスクロール+ハイライト (画像と同じ)
- 保存成功 → iframe 再マウント (既存機構) — /edit は resolveAllTextsFresh なので即反映

## 6. エラーコード

新設なし。E101 (検証: maxLen / kind 違反) / E107 (registry 外 slot_key) / E109 (該当なし — page_text では発生し得ないため未使用) を流用。

## 7. モジュール裁定

page_text は page-media モジュールに**同居**させる (モジュール名は据え置き)。理由: resolver・エディタ統合面・保存経路・revalidate 戦略が画像と完全共通で、モジュールを分けると facade 跨ぎだけが増える。`docs/module-contracts.md` §1 の所有マトリクスを「page_media, page_text (+view page_media_resolved)」に更新し、§5 に追加メソッドを反映する (**実装前に契約書を先に更新** — 本書マージと同一コミットで行う)。

## 8. テスト戦略

| レイヤ | 対象 |
|---|---|
| 単体 | TEXT_REGISTRY: 75 件・key 一意・route 妥当・**page_media SLOT_REGISTRY と key 交差ゼロ**・**defaultText が現行文言と一致** (変換前の frozen fixture と比較 — 変換後 JSX との自己一致にしない、MINOR) / resolver fallback + JSON round-trip / Zod (maxLen 境界・kind=text の改行拒否・registry 外) / textEditableAttrs の editMode 出し分け |
| 結合 | page_text RLS (anon select / admin write / anon write 拒否) / setText upsert・削除 = 既定復帰 |
| E2E (実機) | テキストホットスポット表示 (青) → クリック → 編集 → 保存 → iframe 反映 → 公開ルート反映 / maxLen 超過で保存不可 / 既定に戻す / shared.cta.consult がヘッダー・フッター両方に反映 |
| 非影響 | page_text 空の状態で公開ページのスナップショットが現行一致 / (site) 全ルート SSG 維持 |

## 9. フェーズ分割

| wave | 内容 | 並列 | 依存 |
|---|---|---|---|
| T1 | migration 0014 (apply 込み) + TEXT_REGISTRY 75 件 + facade 拡張 + Zod + editable-attrs + SlotText + 単体テスト | 単独 | — |
| T2a | 公開ページ 75 箇所の SlotText 化 (texts バケツ配線、ページ群で implementer 分割) | 並列 | T1 |
| T2b | エディタ拡張 (青ホットスポット + テキストメニュー + setSlotText + サイドパネル) | 並列 | T1 |
| T3 | 統合 + 実機 E2E + Codex コードレビュー | 単独 | T2a+T2b |

- T2a は SplitChars / kt-hero-line / モーション実装と同じファイルを触るため、**worktree 分離 + 現行構造を壊さない指示を厳守** (V2a と同じ規律)
- 実装は全ウェーブ implementer + tester ペア、2 回連続 PASS

## 10. 更新履歴
| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-07-10 | 初版 (棚卸し 600 箇所 → Tier A 75 件の統合裁定を受けて) |
| v1.1 | 2026-07-10 | Codex レビュー反映 (BLOCKER 0 / MAJOR 5 / MINOR 3)。layout 配線・affectedRoutes・maxLines・multiline div 固定・hotspot ordinal・delete 正規化。**実装 GO** |
| v1.2 | 2026-07-10 | T1 実装時の実測反映: 74 件確定 (story.message.body は strong 装飾のため B 差し戻し)、maxLines は PLAN §3.3 の明示標準 (2 行、statement のみ 5) を優先 |
