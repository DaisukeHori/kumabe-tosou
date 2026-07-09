# sns-image-posting [possible]

**推奨**: X は v2 simple upload (POST api.x.com/2/media/upload、multipart binary、media_category=tweet_image、≤5MB) へ移行し media.write scope を追加 (チャンク実装は動画対応まで不要)。Instagram は既存コンテナ方式 + Supabase public URL のまま Graph v25.0 へ更新し、publish 前 status_code チェックとアスペクト比 4:5〜1.91:1 正規化を追加する。

## リスク
- X: 既存 uploadImageToX は 2025-06-09 に sunset 済みの upload.twitter.com/1.1 を使用しており、画像付き X 投稿は現在必ず失敗する (worker のベストエフォート catch により「画像なしで投稿される」形で顕在化し気付きにくい)
- X: OAuth scope に media.write が無い。scope 追加後は既存の X 接続を再認可 (OAuth フロー再実行) しないと media upload が 403 になる
- X: 2026-02-06 以降は新規 Free/Basic 選択不可の pay-per-use ($0.015/post、URL 含む post は $0.20/post と 13 倍)。接続アカウントが legacy Basic か pay-per-use かで billing guard の単価前提が変わる。media upload 自体の課金有無は pricing 表に明記なし (Developer Console で要確認)
- IG: JPEG のみ + アスペクト比 4:5〜1.91:1 制約。レンディション生成でアスペクト比正規化しないと範囲外画像で publish が確定失敗する
- IG: コードの graph.facebook.com/v21.0 は 2026 年内〜2027 年初に version expiry の可能性 (v20.0 は 2026-09-24 失効確定、v21.0 は未発表)
- IG: instagram_content_publish は外部ユーザー向けには App Review (advanced access) が必要。自社アカウント運用なら開発モード + ロール付与で回避できる場合があるが、Meta アプリの審査状態に依存
- IG: 画像 URL は投稿試行時点で公開アクセス可能であることが必須。Supabase Storage の bucket を private 化する将来変更があると IG 配信が全滅する (現在は public bucket で充足)

---

# SNS 画像投稿 調査報告 (X API v2 / Instagram Graph API) — 2026-07 時点

## 1. 既存実装の現状 (Read 済み)

**結論: テキストのみではなく、画像投稿の骨格は両チャネルとも実装済み。ただし X 側は廃止済み v1.1 エンドポイントを使っており現在は動作しない。**

| ファイル | 現状 |
|---|---|
| `/Users/horidaisuke/projects/kumabe-tosou/src/modules/distribution/internal/x-api.ts` | `uploadImageToX()` が **`https://upload.twitter.com/1.1/media/upload.json`** に base64 (`media_data`) + `application/x-www-form-urlencoded` で単発アップロード (L11, L49-70)。`postTweet()` は v2 `POST /2/tweets` に `media.media_ids` を渡す実装済み |
| `/Users/horidaisuke/projects/kumabe-tosou/src/modules/distribution/internal/instagram-api.ts` | コンテナ方式実装済み: `createMediaContainer` (image_url/caption/is_carousel_item) → `createCarouselContainer` → `publishContainer`。ベース URL は **`graph.facebook.com/v21.0`** (L8)、Facebook Login 経路 |
| `/Users/horidaisuke/projects/kumabe-tosou/src/modules/distribution/internal/worker.ts` | 配線済み: X は `tweet.media_id` → `mediaFacade.getJpegRenditionUrl()` → bytes ダウンロード → `uploadImageToX` (L159-172、失敗時は画像なしで投稿続行のベストエフォート)。IG は `content.media_ids` 全件を JPEG レンディション URL 化 → 単発 or カルーセル → publish (L256-285) |
| `/Users/horidaisuke/projects/kumabe-tosou/src/modules/media/facade.ts` | `getJpegRenditionUrl()` は JPEG レンディションを遅延生成し **Supabase Storage public bucket の恒久公開 URL** を返す (L133-149) → IG の公開 URL 必須要件を満たす |
| `/Users/horidaisuke/projects/kumabe-tosou/src/app/api/oauth/x/start/route.ts` | X OAuth scope = `tweet.read tweet.write users.read offline.access` (L41)。**`media.write` が無い** |
| `/Users/horidaisuke/projects/kumabe-tosou/src/modules/ai-studio/contracts.ts` | `zXTweet.media_id` (nullable、ツイート毎 1 枚)、`zInstagramContent.media_ids` (1〜10 枚) — コンテンツ契約も画像前提で定義済み |

## 2. X API v2 media upload (事実・出典付き)

### 2.1 v1.1 は廃止済み — 既存コードは確実に失敗する
- v1.1 media upload (`upload.twitter.com/1.1/media/upload.json`) は self-serve 開発者 (Free/Basic/Pro) 向けに 2025-03-31 廃止予定と告知され ([Deprecating the v1.1 media upload endpoints](https://devcommunity.x.com/t/deprecating-the-v1-1-media-upload-endpoints/238196))、期限延長の後 **2025-06-09 に sunset 済み** ([Extended deadline for v1.1 media upload endpoints](https://devcommunity.x.com/t/extended-deadline-for-v1-1-media-upload-endpoints/240122))。
- したがって現行コードの X 画像添付は必ず失敗する (worker がベストエフォート catch しているため症状は「画像なしで投稿される」)。

### 2.2 現行 v2 エンドポイント
- **Simple upload (画像向け・非チャンク)**: `POST https://api.x.com/2/media/upload`。パラメータ: `media` (binary、multipart)、`media_category` (`tweet_image` / `dm_image` / `subtitles`)、`media_type` (任意、`image/jpeg` 等)。認証は OAuth 2.0 user context + **`media.write` scope** (または OAuth 1.0a)。応答は `data.id` / `data.media_key` / `data.processing_info`。出典: [Upload media (simple)](https://docs.x.com/x-api/media/upload-media)
  - 注: v1.1 にあった base64 の `media_data` パラメータは v2 simple upload の仕様に記載なし。**binary multipart への書き換えが必要** (推測ではなく docs のパラメータ表に `media` binary のみ)。
- **Chunked upload (専用 3 エンドポイント方式が現行)**:
  - `POST /2/media/upload/initialize` — `media_type`, `total_bytes`, `media_category` (`tweet_image`/`tweet_gif`/`tweet_video`/`dm_video`/`amplify_video`/`subtitles`)。出典: [initialize](https://docs.x.com/x-api/media/media-upload-initialize)
  - `POST /2/media/upload/{id}/append` — `media` (binary chunk) + `segment_index` (0–999)、multipart。出典: [append](https://docs.x.com/x-api/media/media-upload-append)
  - `POST /2/media/upload/{id}/finalize` → `processing_info` が返れば STATUS ポーリング (`pending`→`in_progress`→`succeeded`/`failed`)。出典: [Chunked Media Upload quickstart](https://docs.x.com/x-api/media/quickstart/media-upload-chunked)
  - 旧「`command=INIT/APPEND/FINALIZE` を単一 URL に送る」方式は 2025 年に専用エンドポイントへ移行済み ([移行告知](https://devcommunity.x.com/t/media-upload-endpoints-update-and-extended-migration-deadline/241818)、[新エンドポイントの不具合報告スレ](https://devcommunity.x.com/t/new-dedicated-endpoints-for-chunked-media-upload-broken/241923))。
- **サイズ上限**: 画像 5MB / GIF 15MB / 動画 512MB (`amplify_video` 時)。出典: [Media upload introduction](https://docs.x.com/x-api/media/introduction)
- **1 post あたり画像は最大 4 枚** (`media.media_ids` maxItems: 4)。出典: [POST /2/tweets reference](https://docs.x.com/x-api/posts/creation-of-a-post)
- **レート制限** (ティア区分なしで記載): `POST /2/media/upload` = 50,000/24h (app) / 500/15min (user)。initialize/append/finalize = 各 180,000/24h / 1,875/15min。`POST /2/tweets` = 10,000/24h / 100/15min。出典: [Rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)

### 2.3 無料/Basic プランの可否 — 前提が 2026 年に激変
- **2026-02-06 に pay-per-use へ全面移行。Free tier は新規受付終了** (既存 Free 利用者は $10 クレジット付与で pay-per-use へ移行)。Basic ($200/月)/Pro ($5,000/月) は**既存契約者のみ legacy 継続**、新規は選択不可。出典 (一次): [X API pay-per-usage pricing and credits (docs.x.com)](https://docs.x.com/x-api/getting-started/pricing)、[Pay-Per-Use Pricing Pilot 告知 (devcommunity)](https://devcommunity.x.com/t/announcing-the-x-api-pay-per-use-pricing-pilot/250253)。二次: [Postproxy](https://postproxy.dev/blog/x-api-pricing-2026/)、[Roboin](https://roboin.io/article/en/2026/02/08/x-transitions-api-to-pay-per-use-model-ending-free-plan/)、[GIGAZINE](https://gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/)
- **現行単価** (docs.x.com 記載): post 作成 **$0.015/request**、**URL を含む post は $0.200/request** (13 倍)、summoned posts $0.010、post 読み取り $0.005/resource、owned reads $0.001/resource。出典: [pricing](https://docs.x.com/x-api/getting-started/pricing)
- **media upload 自体の課金**: pricing 表に media upload エンドポイントの課金項目は**記載なし** → 課金は post 作成時のみとみられる (**ここは推測**。Developer Console の現行レートで要確認)。
- media upload の利用可否にティア制限の記載はなし (rate limits 表に全エンドポイント掲載)。`media.write` scope が付与されていれば pay-per-use でも利用可 (**docs に明示の禁止記述がないことに基づく判断**)。

### 2.4 X 側の拡張点 (コード修正必須)
1. `x-api.ts` L11/L49-70: URL を `https://api.x.com/2/media/upload` へ、base64 form → **multipart binary** へ、応答 `media_id_string` → `data.id` へ変更。JPEG レンディション ≤5MB なら simple upload で十分、**チャンクアップロード実装は不要** (動画対応時に initialize/append/finalize を追加)。
2. `/api/oauth/x/start/route.ts` L41: scope に **`media.write` を追加** — 追加後、既存接続は再認可 (Vault トークン再取得) が必要。
3. billing guard (`ops_limits.x_monthly_post_limit` / `estimated_cost_cents`): pay-per-use 単価 $0.015 (URL 付き $0.20) を前提に整合確認。X 投稿テキストに URL を入れる運用なら 1 post $0.20。

## 3. Instagram Graph API 画像投稿 (事実・出典付き)

### 3.1 コンテナ方式 — 現行仕様どおり (既存実装と一致)
- 2 段階: `POST /{ig-user-id}/media` (コンテナ作成) → `POST /{ig-user-id}/media_publish` (公開)。出典: [Content Publishing (Instagram Platform)](https://developers.facebook.com/docs/instagram-platform/content-publishing)
- **公開 URL 必須 (確定)**: 「We cURL media used in publishing attempts, so the media must be hosted on a publicly accessible server at the time of the attempt」— 認証付き URL・localhost 不可。本リポジトリは Supabase Storage public bucket の恒久 URL を渡すので要件充足。
- **JPEG のみ (確定)**: 「JPEG is the only image format supported. Extended JPEG formats such as MPO and JPS are not supported」(PNG 不可)。既存の JPEG レンディション方針は正しい。
- **画像仕様** (POST /{ig-user-id}/media reference): 最大 **8MB**、アスペクト比 **4:5〜1.91:1** (範囲外はエラー)、最小幅 320 (自動拡大)、最大幅 1440 (自動縮小)、sRGB (他色空間は自動変換)。出典: [IG User Media reference](https://developers.facebook.com/docs/instagram-api/reference/ig-user/media)
- **カルーセル**: 最大 10 要素、`children` にコンテナ ID、キャプションは親のみ (子には不可)、全画像が先頭画像基準でクロップ (デフォルト 1:1)。`zInstagramContent.media_ids` の max 10 は上限と一致。
- **レート制限**: **100 API 発行投稿 / 24 時間 (移動窓)**。カルーセルは 1 カウント。消費量は `GET /{ig-user-id}/content_publishing_limit` で確認可。本 CMS の投稿量では実質制約にならない。
- **コンテナ状態確認**: `GET /{container-id}?fields=status_code` → `EXPIRED` / `ERROR` / `FINISHED` / `IN_PROGRESS` / `PUBLISHED`。画像は通常即 FINISHED だが、publish 前チェックがベストプラクティス (現行コードは create → publish 直行)。
- **2 経路**: Instagram API with Instagram Login (`graph.instagram.com`、FB ページ不要) / with Facebook Login (`graph.facebook.com`、FB ページ紐付け必須)。既存コードは後者で、`resolveInstagramBusinessAccount` も FB ページ経由 — このままで問題なし。
- **権限**: Facebook Login 経路は `instagram_basic` + `instagram_content_publish` + `pages_read_engagement` (Business Manager 経由のページロールなら `ads_management`/`ads_read` も)。出典: [Content Publishing (FB Login)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing)

### 3.2 Graph API バージョン
- 現行最新は **v25.0 (2026-02-18 リリース)**。v21.0 (2024-10-02) は expiry 未確定だが、v20.0 が 2026-09-24 expiry のため v21.0 も 2026 年内〜2027 年初の失効が見込まれる (**失効日は未発表 = 推測**)。出典: [Graph API Versions](https://developers.facebook.com/docs/graph-api/changelog/versions/)、[v25.0 告知](https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25/)

### 3.3 IG 側の拡張点 (小規模)
1. `instagram-api.ts` L8: `v21.0` → `v25.0` (最低でも v23.0+) へ更新。
2. `publishContainer` 前に `status_code` チェック (ERROR/IN_PROGRESS 時のリトライ) を追加すると堅牢。
3. `media/internal/image-transform.ts` の JPEG レンディション生成にアスペクト比 4:5〜1.91:1 の検証/正規化と max width 1440 リサイズを入れると publish 失敗 (E502) を予防できる。

## 4. 結論
両チャネルとも画像投稿は技術的に可能で、実装骨格は既に存在する。必須修正は (1) X の v1.1 → v2 simple upload 移行 + `media.write` scope 追加 + 再認可、(2) IG の Graph バージョン更新、の 2 点。IG のコンテナ方式・公開 URL・JPEG 前提は既存設計と完全に一致しており大改修は不要。
