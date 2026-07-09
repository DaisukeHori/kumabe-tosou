# fullpage-screenshot [possible]

**推奨**: puppeteer-core + @sparticuz/chromium を Vercel Functions (Node, hnd1, メモリ2GB以上, maxDuration 60s〜) で自前実装し、フルページ PNG は Supabase Storage 保存・URL 返却。/tmp クリーンアップ + reduced-motion エミュレート + webfont 待ちを必須要件とし、16,384px 超ページのみ分割撮影 + sharp 結合。運用が不安定化したら ScreenshotOne ($17/2,000枚) へ切替可能なようスクショ取得部をアダプタ化しておく。

## リスク
- Fluid Compute のインスタンス再利用で /tmp に Chromium 展開物・プロファイルが蓄積し起動失敗する既知問題 (Vercel 公式コミュニティで成功率50%事例、Sparticuz/chromium#231)。撮影前後の /tmp クリーンアップと同時実行1に絞る排他制御を実装要件に入れること
- Vercel Functions のレスポンスボディ上限 4.5MB — フルページ PNG は容易に超過するため、画像は必ず Supabase Storage に保存し URL を返す設計にする (直返しすると FUNCTION_PAYLOAD_TOO_LARGE)
- Chromium software GL の最大テクスチャ 16,384px 制限 — 縦 16,384px 超のページは下部が白落ちする。最長ページの scrollHeight を実装時に実測し、超える場合はスクロール分割撮影 + sharp 結合の分岐を用意
- @sparticuz/chromium はパッチバージョンでも breaking change があり、puppeteer-core とのバージョン整合を package.json で固定 (^ でなく exact pin) しないと突然壊れる
- @sparticuz/chromium 同梱フォントは Open Sans のみ (日本語なし)。本サイトは next/font の自己ホスト webfont で実質回避できるが、webfont ロード完了待ち (document.fonts.ready / networkidle) を省くと豆腐や FOUT 状態が写る
- スクロール連動アニメーション (docs/design/motion-specs 実装) が中途半端な状態で写る — CDP で prefers-reduced-motion: reduce をエミュレートするか、撮影用クエリパラメータでモーション無効化が必要
- Large Functions (5GB) は一部 beta 表記が残り Secure Compute / Static IPs 非対応 — フル版バンドル方式を採る場合は仕様変更を追跡。確実性重視なら公式テンプレートの chromium-min + リモート pack 方式
- 外部 API 案を採る場合: ApiFlash の料金は二次情報のみで裏取り未了、Cloudflare Browser Rendering の REST screenshot エンドポイント詳細も料金ページ外 (採用時は公式 doc 再確認要)

---

# Vercel サーバレスでの自サイト・フルページスクリーンショット (2026-07 時点)

## 0. 前提 (リポジトリ実測)

- 本リポジトリは Next.js 15.5 / React 19 / Node `>=20.11 <23`、Vercel region `hnd1`、`sharp@0.35` が既に依存に存在 (`/Users/horidaisuke/projects/kumabe-tosou/package.json`, `vercel.json`)
- サイトの日本語本文フォントは **next/font/google 経由の Noto Sans JP (自己ホスト webfont)**。`--font-body` (Zen Kaku Gothic New) は「現行実装では未読み込み。フォールバックスタックのみ残す」とコメントされ、使用箇所なし (`src/app/globals.css` L156-163 実測)。→ **自サイトを headless Chromium で開けば日本語はページ自身の webfont で描画されるため、サーバ側フォント問題は大幅に軽減される** (事実)。ただし webfont ロード完了待ち (`document.fonts.ready` / networkidle) は必須 (推測ではなく一般要件)
- `docs/design/motion-specs/*` にスクロール連動アニメーション仕様が多数あり → フルページ撮影時は CDP で `prefers-reduced-motion: reduce` をエミュレートしないと中途半端なアニメ状態が写る (リポジトリ実測に基づく設計上の注意)

---

## 1. 方式A: 自前ホスト — puppeteer-core + @sparticuz/chromium (推奨)

### Vercel 公式サポート状況 (事実)
- Vercel 公式 KB「Deploying Puppeteer with Next.js on Vercel」が存在し、**`puppeteer-core` + `@sparticuz/chromium-min`** を公式推奨。理由は関数バンドル 250MB 制限。公式テンプレートあり
  - https://vercel.com/kb/guide/deploying-puppeteer-with-nextjs-on-vercel
  - https://vercel.com/templates/next.js/puppeteer-on-vercel
- テンプレートの仕組み: postinstall で Chromium バイナリを `public/chromium-pack.tar` に展開配置 → 実行時に `@sparticuz/chromium-min` が `https://${VERCEL_URL}/chromium-pack.tar` から DL・`/tmp` に展開・実行パスをメモリキャッシュ。GitHub Releases の pack URL 直接指定も可

### @sparticuz/chromium の現状 (事実、GitHub README)
- 最新 **v149.0.0 (2026-05-27)**。Brotli 圧縮 ~38.26MiB → 展開 ~130.62MiB。現行 AWS Lambda Node ランタイム (Node 20/22) 対応 = Vercel Node ランタイムで動作。x86_64 前提
- バージョン規約 `MajorChromium.Minor.Patch` で **パッチレベルでも breaking change あり得る**。puppeteer-core とのバージョン整合は Puppeteer の Chromium Support ページで確認する運用
- **Playwright も README で公式サポート** (playwright-core + executablePath 指定の例コードあり)。ただし「Playwright は warm invocation 間で user-data-dir を自動削除せず `/tmp` を食い潰す」既知問題が README に明記 → 一意な `--user-data-dir` + 撮影後削除が必須
- 出典: https://github.com/Sparticuz/chromium / https://www.npmjs.com/package/@sparticuz/chromium

### Vercel Functions 制限 (事実、公式 docs 2026-07-01 更新)
出典: https://vercel.com/docs/functions/limitations

| 項目 | 値 |
|---|---|
| バンドルサイズ (uncompressed) | **250MB**。**Large Functions で最大 5GB** (Fluid Compute + Active CPU 必須、新規プロジェクトはデフォルト有効。ドキュメント上 beta 表記が一部残存) |
| メモリ | Hobby 2GB/1vCPU (上限)、Pro/Ent 最大 4GB/2vCPU |
| maxDuration | Hobby 300s。Pro/Ent 800s (拡張 1800s は beta) |
| **レスポンスボディ上限 4.5MB** | フルページ PNG は容易に超える → **画像はレスポンス直返しせず Supabase Storage に保存して URL を返す設計が必須** |

→ **250MB 問題は 2026 年時点でほぼ解消**: (a) chromium-min + リモート pack 方式 (公式テンプレート)、(b) Large Functions (5GB) でフル版 `@sparticuz/chromium` (~131MB 展開) を直接バンデル、の 2 経路が取れる。

### Fluid Compute の実害 (事実)
- Fluid Compute はインスタンスを再利用するため **`/tmp` にダウンロード・展開した Chromium やプロファイルが蓄積し、`libnspr4.so: cannot open shared object file` 等で起動失敗率 ~50% に達した事例** が Vercel 公式コミュニティに報告済み (2025-04)。Vercel スタッフは `/tmp` 手動クリーンアップを「hacky」と認めつつ根本解決は提示せず。関連 issue: Sparticuz/chromium#231
- 出典: https://community.vercel.com/t/enabling-fluid-compute-broke-playwright-scraping/8840
- **対策 (設計要件)**: 撮影の前後に `/tmp` の chromium 展開物・user-data-dir を明示削除。ブラウザ起動をモジュールスコープの排他 (同時 1 起動) にする

### Playwright 単体の Vercel 対応 (事実+区別)
- Playwright 公式には serverless/Vercel サポートは存在しない (公式 docs に記載なし)。動かすなら上記 @sparticuz/chromium 併用 (README 公式サポート) か、後述のリモートブラウザ接続 (Browserless 等に `playwright-core` の `connect()`) のいずれか

### Vercel Sandbox という新選択肢 (事実、参考)
- Vercel Sandbox (Firecracker microVM、任意コード実行) 内で headless Chromium / agent-browser を動かす公式パターンが 2025-2026 に登場。スナップショット利用で起動 sub-second。関数サイズ制限の外側で動く。CMS のスクショ用途にはオーバーキルだが、将来ブラウザ自動化を広げるなら候補
- 出典: https://vercel.com/docs/sandbox / https://github.com/vercel-labs/agent-browser

---

## 2. 長いページの full-page 対応 (事実)

- Chromium の software GL バックエンドは **最大テクスチャ 16,384px**。フルページスクショで縦 16,384px を超えた部分は白落ちする既知バグ (Chromium issue は long-standing で未解決)
  - https://issues.chromium.org/issues/41347676
  - https://github.com/puppeteer/puppeteer/issues/359
- 対策: (1) 16,000px 以下ならそのまま `fullPage: true` (`captureBeyondViewport` はデフォルト有効)、(2) 超える場合は viewport 高さずつスクロール撮影 → **既存依存の sharp で縦結合**。lazy-load 画像・スクロール発火アニメ対策として、撮影前に最下部まで一度スクロール + `prefers-reduced-motion` エミュレートを行う
  - 手順解説: https://screenshotone.com/blog/a-complete-guide-on-how-to-take-full-page-screenshots-with-puppeteer-playwright-or-selenium/
- 本サイトのページ高さは通常 16,384px 未満と推測 (未計測 = 推測)。実装時に最長ページ (works 一覧等) の scrollHeight を実測して分岐要否を決めるべき

## 3. 日本語フォント (事実)

- `@sparticuz/chromium` 同梱フォントは **Open Sans のみ (Latin/Greek/Cyrillic)** → システムフォント頼みの日本語は豆腐になる
- 追加手段は 2 つ (README 記載): (1) `await chromium.font("<URL or path>")` で実行時ロード、(2) `/var/task/fonts`・`/tmp/fonts` 等の規約ディレクトリに TTF を配置 (`fonts.conf` で参照)
- **本リポジトリは全日本語テキストが next/font の自己ホスト webfont (Noto Sans JP / Shippori Antique B1) なので、自サイト撮影に限れば追加フォント無しでも実用上豆腐は出にくい** (リポジトリ実測+仕様からの強い推論)。ただし保険として NotoSansJP Regular を `chromium.font()` でロードしておくのが安全 (フォールバック経路・admin 画面・外部埋め込み対策)

---

## 4. 方式B: 外部スクリーンショット API 料金比較 (2026-07、公式ページ実測)

| サービス | 無料枠 | 有料 | full-page | 備考 |
|---|---|---|---|---|
| **ScreenshotOne** | 100枚/月 | $17/2,000枚、$79/10,000枚、$259/50,000枚。超過 $0.009〜 | 全プラン対応 | 成功レンダーのみ課金。キャッシュヒットは非課金。https://screenshotone.com/pricing/ |
| **Urlbox** | 7日トライアル | $19/2,000、$49/5,000、$99/15,000 renders | 全プラン対応 | 「Emoji & Font Support」全プラン明記。https://urlbox.com/pricing |
| **ApiFlash** | 100枚/月 | $7/1,000、$35/10,000 (二次情報、要公式確認) | 対応 | AWS Lambda ベース。https://apiflash.com/ |
| **Browserless** | 1,000 units/月・2並列 | $25/月〜 (年払)。1 unit = ブラウザ接続 30 秒、超過 ~$0.015/unit | 自前コード次第 | スクショ API ではなく**リモートブラウザ**。Vercel 関数から `puppeteer.connect(browserWSEndpoint)` / `playwright-core connect()` で CDP 接続 → バンドルサイズ・/tmp 問題が消える。https://www.browserless.io/pricing |
| **Cloudflare Browser Rendering** | 10分/日・3並列 | Workers Paid ($5/月) に 10 時間/月込み、超過 $0.09/時、同時 10 ブラウザ超過 $2/ブラウザ | REST API に screenshot 系エンドポイントあり (料金ページ外、要 API doc 確認) | https://developers.cloudflare.com/browser-rendering/platform/pricing/ |

- 補足 (二次情報): 2026 年の比較記事では ScreenshotOne が機能面の市場リーダー、価格面では低価格帯サービス (SnapRender 等) が半額以下との整理。https://medium.com/@TheTechDude/screenshot-api-pricing-compared-what-you-actually-pay-per-screenshot-in-2026-18f38320251f
- 日本語レンダリング: いずれもフル Chrome を運用しており CJK フォントは通常同梱される (推測)。ScreenshotOne/ApiFlash の料金ページに日本語フォントの明記はなし (実測)。本件は自サイト撮影で webfont が効くため実質問題にならない (前述)

## 5. 方式C: クライアント側 (管理画面ブラウザ) — 非推奨

- **html2canvas**: 最終リリース 1.4.1 は 2022 年、事実上メンテ停滞。CSS を JS で再実装する方式のため modern CSS (oklch カラー、backdrop-filter、グラデーション等) 非対応が多い。本サイトは Tailwind CSS 4 (oklch 出力) なので破綻リスク大 (事実+リポジトリ適合性の推論)。https://npm-compare.com/@zumer/snapdom,html2canvas
- **snapdom (@zumer/snapdom)**: 2025 年登場の SVG foreignObject 方式。pseudo-element / webfont / Shadow DOM 対応で html2canvas より忠実、活発にメンテ中 (事実)。https://github.com/zumerlab/snapdom / https://snapdom.dev/
  - ただし「レンダリング済みブラウザ画面のキャプチャ」ではなく「DOM の再直列化」なので、canvas/video/cross-origin 画像や複雑なアニメ状態は完全一致しない (方式上の事実)。また撮影対象ページを管理画面内 iframe で開く必要があり same-origin 制約・実装コストが乗る (推論)
- **getDisplayMedia**: MDN 明記の制約 — 「**許可は永続化できず毎回ユーザープロンプト必須**」「**transient user activation 必須**」。キャプチャ対象は表示中のサーフェス (タブの可視領域) であり、**スクロール外のコンテンツは撮れない** → フルページには手動スクロール+結合が必要で CMS の自動化用途に不適 (事実)。https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- 結論: クライアント側方式は「見た目の忠実度」「フルページ」「自動化」のいずれかを必ず犠牲にする。CMS のサムネ/承認スナップショット用途ではサーバ側が優位

---

## 6. 総合比較

| 方式 | 初期コスト | ランニング | 忠実度 | 運用リスク |
|---|---|---|---|---|
| A. 自前 (puppeteer-core + @sparticuz/chromium) | 実装 1 日程度 | Vercel 従量のみ (低頻度ならほぼ 0) | 実ブラウザ = 最高 | /tmp 枯渇・バージョン整合・16384px |
| A'. Browserless 接続型 | 実装 0.5 日 | 無料 1,000 units/月 → $25/月 | 実ブラウザ = 最高 | 外部依存・unit 課金の読みにくさ |
| B. ScreenshotOne 等 API | 実装 0.2 日 | 無料 100/月 → $17/月 | 実ブラウザ = 最高 | 外部依存・月額固定 |
| C. クライアント側 (snapdom) | 実装 0.5 日 | 0 | 中 (再直列化) | 忠実度・iframe 制約 |
