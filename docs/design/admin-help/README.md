# 管理画面ヘルプ (canonical 設計書)

管理画面の全ページに「このページの使い方」を別ウィンドウで開くヘルプを付ける。読者は **高校生でも分かる** ことを基準にする (専門用語は初出で言い換え、1 文は 40 字前後、箇条書きを多用)。実装は本書を canonical とし、逸脱する場合は本書を先に更新する。

## 1. 目的と読者

- 目的: 管理者 (代表の山岸さん、事務スタッフ) が、誰にも聞かずに各画面を使い切れること。
- 読者像: PC 操作は「ブラウザとメールが使える」程度。業務 (塗装受託・見積・請求・SNS 発信) は知っているが、システム用語は知らない。
- 禁止: 環境変数名・内部識別子・ファイル名を本文に出さない。エラー番号 (KMB-E###) は「画面に表示されたときの意味」として FAQ で扱う場合のみ可。

## 2. 入口: 右上の「?」ボタン

- 共通ヘッダー部品 `PageHeader` (`src/app/admin/_ui/page-header.tsx`) の右端に `HelpButton` (client component) を常設する。`actions` の右隣、丸い「?」アイコン + ツールチップ「このページの使い方」。
- `HelpButton` は `usePathname()` から `resolveHelpSlug(pathname)` (純関数、`src/help/slugs.ts`) でヘルプ slug を決める。slug が解決できないパスではボタンを出さない (テストで全 admin ページが解決できることを保証する)。
- クリック時: `window.open("/help/<slug>", "kmb-help", "width=1180,height=920,noopener")`。同じウィンドウ名を使い回すので、別ページで押しても 1 枚のヘルプウィンドウが切り替わる。
- `PageHeader` を使っていないページ (現時点では `/admin/documents/[id]`) には個別に `HelpButton` を置く。
- ログイン画面にはヘルプボタンを出さない代わりに、ログインフォームの下に「ログインできないとき」の短い FAQ リンク (`/help/login`) を置く。`/help/login` だけは未ログインでも閲覧可。

## 3. ヘルプページ本体: `/help/[slug]`

- ルート: `src/app/help/[slug]/page.tsx` + 専用 `layout.tsx` (管理画面のサイドナビは出さない。左に目次、右に本文、上部に「印刷」「管理画面に戻る」)。
- 認証: `requireAdminPage()` で保護 (未ログインは `/admin/login?next=/help/<slug>`)。`next` の許可 prefix に `/help` を追加する (`src/app/admin/login/next-path.ts`)。`/help/login` のみ例外で公開。
- 画像: `public/help/<slug>/<name>.png` に置く。`src/middleware.ts` の matcher に `/help/:path*` を追加し、セッション Cookie が無いアクセスは `/admin/login` へ (画像も同じ matcher で守る)。
- 構成 (全ページ共通・この順番):
  1. **このページでできること** — 3〜6 箇条。「〜できます」で終える。
  2. **利用のフロー** — 番号付きステップ (矢印で接続)。各ステップに「どこを押すか」と「終わるとどうなるか」。
  3. **画面の見方** — スクリーンショット + 注釈 (赤枠 / 矢印 / 番号バッジ)。番号ごとに「何のための項目か」「入力・変更すると他のどの画面に影響するか (関連)」を書く。
  4. **こんなときは (ユースケース)** — ペルソナが実際の業務をこなす一連の流れ。2〜3 本。各ステップに画面の場所と結果。
  5. **よくある質問** — 10 問以上。「できない」「消えた」「間違えた」「どこにある」を優先。
  6. **関連するページ** — リンク一覧。
  7. **用語** (必要なページのみ)。

## 4. コンテンツの型 (`src/help/types.ts`)

```ts
export type HelpAnnotation =
  | { kind: "box"; x: number; y: number; w: number; h: number; number?: number; label?: string }
  | { kind: "arrow"; x: number; y: number; toX: number; toY: number; label?: string }
  | { kind: "badge"; x: number; y: number; number: number };
// 座標は元画像のピクセル。レンダラーが % に変換して SVG オーバーレイで描く (画像は差し替えても注釈が追従する)。

export type HelpScreenshot = {
  src: string;            // "/help/<slug>/<name>.png"
  alt: string;
  width: number; height: number;   // 元画像サイズ
  annotations: HelpAnnotation[];
  caption?: string;
};

export type HelpDoc = {
  slug: string; title: string; adminPath: string;
  summary: string[];
  flow: { step: string; where: string; result: string }[];
  sections: {
    id: string; heading: string;
    body: string[];                       // 段落 (プレーン文。太字は **〜**)
    screenshot?: HelpScreenshot;
    items?: { number: number; name: string; what: string; affects?: string }[];  // 注釈番号と対応
    relations?: { label: string; href: string; why: string }[];
  }[];
  useCases: {
    persona: "yamagishi" | "sato" | "customer";
    title: string; situation: string;
    steps: { action: string; where: string; result: string; screenshot?: HelpScreenshot }[];
    outcome: string;
  }[];
  faqs: { q: string; a: string }[];
  related: { label: string; href: string }[];
  glossary?: { term: string; meaning: string }[];
};
```

- ペルソナ (`src/help/personas.ts`):
  - **山岸 信之** (代表・塗装職人。現場が中心でパソコンは夜に少しだけ。スマホでの確認が多い)
  - **佐藤 さん** (事務スタッフ、週 3 日。見積・請求・入金確認とメール対応を担当)
  - **お客様 (田中さん)** (3D プリント造形を依頼する法人担当者。初めて問い合わせる)
- 1 ページあたりの最低量: スクリーンショット 3 枚以上 (一覧 / 詳細かフォーム / 操作後の変化)、1 枚につき注釈 3 箇所以上、ユースケース 2 本以上、FAQ 10 問以上。

## 5. スクリーンショットの撮り方 (`scripts/help-screenshots/`)

- `playwright-core` + 同梱 Chromium (`/opt/pw-browsers/chromium*/chrome-linux/chrome` を `executablePath` に指定)。ビューポート 1440×900、`deviceScaleFactor: 2`、日本語フォントが出ることを確認してから撮る。
- 撮影先は **開発サーバー (localhost:3000)** で、接続先 DB は **Supabase の開発ブランチ `help-screenshots`** (本番データは写さない)。ブランチには `scripts/help-screenshots/seed-demo.sql` のデモデータ (架空の顧客・案件・見積・請求・予定・通話・問い合わせ・記事) を投入する。
- ログイン: 撮影用の管理者 (ブランチ DB 上のみ) でログインし、`storageState` を再利用する。
- 注釈座標: 撮りたい要素に `data-help="<key>"` 属性を付け、撮影時に `locator.boundingBox()` を取って `public/help/<slug>/<name>.json` に保存する。コンテンツはこの JSON を import して `annotations` を組み立てる (手打ち座標は禁止。座標のずれを防ぐため)。
- ファイル名: `01-list.png`, `02-detail.png`, `03-after-save.png` のように番号 + 内容。1 ページ 3〜6 枚。

## 6. 対象ページ一覧 (slug / URL / タイトル)

| slug | URL | タイトル |
|---|---|---|
| dashboard | /admin | 今日の仕事 |
| works | /admin/works, /admin/works/new, /admin/works/[id] | ホームページ更新 — 施工事例 |
| posts | /admin/posts, /new, /[id] | ホームページ更新 — 記事 (ブログ・読みもの) |
| voices | /admin/voices, /new, /[id] | ホームページ更新 — お客様の声 |
| media | /admin/media | ホームページ更新 — 画像 |
| visual | /admin/visual | ホームページ更新 — 見た目と文章の編集 |
| studio | /admin/studio | 発信スタジオ (音声から記事・投稿を作る) |
| channels | /admin/channels | SNS の接続と配信 |
| inquiries | /admin/inquiries | 問い合わせ |
| calls | /admin/calls, /admin/calls/[id] | 通話 (着信・留守電・文字起こし) |
| customers | /admin/customers, /new, /[id] | 顧客 |
| deals | /admin/deals, /new, /[id] | 案件 |
| tasks | /admin/tasks | やること |
| documents | /admin/documents, /new, /[id] | 見積書・請求書 |
| calendar | /admin/calendar | カレンダー (作業予定) |
| calendar-connections | /admin/calendar/connections | カレンダー — 外部連携 (Google / Microsoft) |
| calendar-templates | /admin/calendar/templates | カレンダー — テンプレート |
| calendar-types | /admin/calendar/types | カレンダー — 作業種別 |
| prices | /admin/prices | 価格表 |
| settings | /admin/settings (全タブ: 会社情報 / ヒーロー / SEO / 計測 / ブランディング / 運用上限 / 通知 / 週間稼働 / 電話 / 営業時間 / 請求書発行者 / AI / 外部連携 / アカウント) | 設定 |
| costs | /admin/costs | AI 利用料金 |
| login | /admin/login | ログイン (未ログインでも閲覧可) |

一覧・新規・詳細は 1 つの slug にまとめ、ヘルプ内で「一覧」「新規作成」「詳細」の節に分ける。

## 7. 品質基準 (レビューで必ず確認)

- 高校生が読んで詰まる語がない (例: 「楽観的排他」→「他の人が先に保存していたら、上書きしないで知らせる仕組み」)。
- すべてのスクリーンショットが存在し、注釈番号と本文の番号が一致する。
- 「関連」が具体的: 「顧客を削除すると案件一覧からも消えます」のように、どの画面に何が起きるか。
- FAQ は実際に起こりそうな失敗から書く (保存できない / 見つからない / 送れない / 二重になった / 間違えて消した)。
- リンク切れなし (`/admin/...` と `/help/...` は実在ルートのみ)。
- 個人情報・本番データが写っていない (デモデータのみ)。
