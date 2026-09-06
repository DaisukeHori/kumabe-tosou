# 管理画面ヘルプのスクリーンショット撮影

canonical 設計書: `docs/design/admin-help/README.md` (§5 が撮影の決まりごと)。

## 準備

1. 開発サーバーを起動する (本番ではなく **開発サーバー** で撮る)。
   ```bash
   ss -ltn | grep 3000 || (nohup npx next dev -p 3000 > /tmp/next-dev.log 2>&1 &)
   curl -s --retry 30 --retry-delay 2 --retry-all-errors -o /dev/null http://localhost:3000/admin/login
   ```
   接続先の DB は Supabase の開発ブランチ `help-screenshots`。本番データは絶対に写さない。
2. デモデータは `scripts/help-screenshots/seed-demo/*.sql` を開発ブランチへ投入したもの。
   自分のページに足りないデータがあるときは **追加のみ** 行い、投入した SQL を
   `seed-demo/<slug>.sql` に保存する (既存データの削除・更新はしない)。
3. ログイン状態は `scripts/help-screenshots/.auth/state.json` に保存され、次回から再利用される
   (git 管理外)。壊れたら消せば再ログインする。

## 撮る

```bash
npx tsx scripts/help-screenshots/pages/<slug>.ts
```

出力は `public/help/<slug>/NN-name.png` と、同じ名前の `.json` (注釈座標)。

## 1 枚の撮り方 (capture)

```ts
import { createHelpContext, launchHelpBrowser, newHelpPage } from "../lib/browser";
import { capture, help } from "../lib/capture";

await capture(page, {
  slug: "customers",
  name: "01-list",            // 番号 + 内容。1 ページ 3〜6 枚
  url: "/admin/customers",
  waitFor: '[data-help="customer-table"]',   // 出現を待つ要素
  anchors: [help("customer-table"), help("customer-search"), help("customer-new")],
  clipTo: { selectors: ['[data-help="customer-table"]'], padding: 20 }, // 一部だけ切り取る (任意)
  fullPage: false,            // 画面全体を縦に長く撮るときだけ true
  actions: async (p) => { await p.click('[data-help="customer-tab-company"]'); }, // 任意
});
```

- `anchors` の `help("キー")` は `data-help="キー"` を指す。**注釈を打ちたい要素には
  必ず `data-help` を付ける** (座標の手打ちは禁止)。要素が見つからないと撮影は失敗する。
- `page.goto` の待ち方は `domcontentloaded` + 要素待ちで固定してある。
  `networkidle` は `/admin/visual` や `/admin/studio` で終わらないので使わない。
- 画像は 1440×900・2 倍解像度で撮る。JSON の `width`/`height` は見た目のピクセル
  (画像の縦横比と同じ) なので、そのまま注釈の座標系として使える。
- `clipTo` を使うときは、**`anchors` に入れた要素を必ず `clipTo.selectors` にも入れる**。
  切り取り範囲の外の要素を注釈すると座標が画像の外になり、番号だけあって枠が見えない
  不良注釈になる。撮影時に検出して失敗させるようにしてある (画面より縦に長い要素が
  下にはみ出すぶんは警告のみ)。
- 初回コンパイルが重い画面 (`/admin/deals/[id]` など) で `page.goto` が 60 秒に
  間に合わないときは `gotoTimeout: 240_000` のように延ばす。
- `fullPage: true` で撮ると左メニューの下端 (撮影用アカウントの表示) まで写る。
  本文だけを見せたいときは `clipTo` で切り取る。
- 撮影用ブラウザはこの環境から外部へ出られないため、Supabase Storage の画像は
  そのままでは灰色の四角になる。`page.route` で同じ画像ファイルをローカルから返してから
  撮る (実例: `pages/media.ts` の `serveDemoImagesLocally`)。

## 注釈を本文で使う

```tsx
import { createAnnotator, type HelpShotJson } from "../annotate";
import shotJson from "../../../public/help/customers/01-list.json";

const list = createAnnotator(shotJson as HelpShotJson);
const listShot = list.screenshot({
  src: "/help/customers/01-list.png",
  alt: "顧客の一覧",
  annotations: [
    list.box("customer-search", 1),        // 赤枠 + 番号
    list.box("customer-table", 2),
    list.badge("customer-new", 3),         // 番号バッジだけ
    list.arrow("customer-new", "customer-table", "ここに増えます"), // 矢印
  ],
});
```

番号は本文の `items[].number` と必ず一致させる (テストが一致を確かめる)。

## 撮り直すとき

同じスクリプトをもう一度実行するだけでよい。要素の位置が変わっても JSON が
更新されるので、本文側の修正は不要 (座標を書いていないため)。
