# openai-image [possible]

**推奨**: gpt-image-2 一択 (旧モデルは 2026 年内に全滅)。レタッチ/参照画像 1〜4 枚生成は images/edits、新規生成は images/generations を使い、非同期ジョブ + IPM キュー制御で Vercel タイムアウトとレート制限を吸収する設計を推奨。

## リスク
- モデル退役ラッシュ: gpt-image-1 は 2026-10-23、gpt-image-1.5 / gpt-image-1-mini / chatgpt-image-latest は 2026-12-01 に API 停止。新規実装で gpt-image-2 以外を選ぶと年内に強制移行が発生する (公式 deprecations ページ)
- gpt-image-2 は background=transparent 非対応 (公式明記)。透明 PNG が要件なら退役予定の gpt-image-1.5 か背景除去の後処理が必要
- レート制限が厳しい: Usage Tier 1 は 5 images/min (IPM)。CMS で複数枚一括生成すると即座に 429 になるためキュー/リトライ設計が必須。Tier は課金実績で上がる
- 生成レイテンシ最大 2 分 (公式)。Vercel Route Handler のデフォルトタイムアウトを超えうるため maxDuration 延長 (Fluid compute) か非同期ジョブ + ポーリング設計が必要
- medium/high 品質の単価が gpt-image-1.5 比で約 1.6 倍に上昇 ($0.053/$0.211 per 1024² 画像)。高品質を多用すると費用が想定超過しうる
- GPT image 系 API の利用に組織認証 (API Organization Verification) が必要。未認証だと 403 になる
- レスポンスは常に base64 返却 (URL 返却なし) のため、Supabase Storage への保存処理をサーバ側で実装する必要がある
- サイズ別 (1536×1024 等) の per-image 単価は公式 calculator でしか確認できず、本調査の抽出値には逆転らしき不確実性あり。実装前に calculator で単価を再確認すべき

---

# OpenAI 画像生成 API 2026年7月時点の最新状況

## 1. モデルラインナップ (2026-07 時点)

| モデルID | 状態 | 備考 |
|---|---|---|
| `gpt-image-2` | **現行最新・推奨** | snapshot `gpt-image-2-2026-04-21`。ChatGPT Images 2.0 として 2026-04-21 発表、API は 2026-05 上旬から開放 |
| `gpt-image-1.5` | 非推奨 (deprecated) | snapshot `gpt-image-1.5-2025-12-16`。**2026-12-01 に API 停止** → gpt-image-2 へ移行 |
| `gpt-image-1-mini` | 非推奨 | **2026-12-01 停止** → gpt-image-2 へ |
| `gpt-image-1` | 非推奨 | **2026-10-23 停止** → gpt-image-2 へ |
| `chatgpt-image-latest` | 非推奨 | **2026-12-01 停止** → gpt-image-2 へ |
| `dall-e-2` / `dall-e-3` | **停止済み (2026-05-12)** | 使用不可 |

「GPT-5 系画像モデル」という命名は存在せず、後継は gpt-image-1.5 (2025-12) → gpt-image-2 (2026-04) という系譜 (事実)。

- 出典: 公式モデル一覧/deprecations: https://developers.openai.com/api/docs/deprecations 、 https://developers.openai.com/api/docs/models/gpt-image-2 、 https://developers.openai.com/api/docs/models/gpt-image-1.5
- gpt-image-2 発表: https://openai.com/index/introducing-chatgpt-images-2-0/ (403 で直接取得不可、検索結果より)、gpt-image-1.5 発表: https://openai.com/index/new-chatgpt-images-is-here/

## 2. エンドポイント

gpt-image-2 は以下 3 つに対応 (公式モデルページで確認):

1. **`POST /v1/images/generations`** — テキスト→画像生成
2. **`POST /v1/images/edits`** — 入力画像 + テキスト指示による編集 (レタッチ)。マスク指定 (inpainting) も可
3. **`POST /v1/responses`** — Responses API の `image_generation` ツール (会話コンテキスト内でのマルチターン生成・編集)

Chat Completions は gpt-image-1.5 のみ対応、gpt-image-2 は非対応。streaming (`stream: true` + `partial_images` 0〜3) は Image API / Responses API 双方で対応。

- 出典: https://developers.openai.com/api/docs/guides/image-generation 、 https://developers.openai.com/api/reference/resources/images/methods/generate 、 https://developers.openai.com/api/reference/resources/images/methods/edit

## 3. 入力画像を使った編集 (レタッチ) — 可能

`images/edits` の仕様 (公式 API リファレンス):

- **`image[]`: GPT image 系モデルは最大 16 枚**の入力画像を受け付ける。1 枚あたり最大 50MB (PNG/JPEG/WebP)。base64 / URL / Files API の file_id で指定可
- **`mask`**: アルファチャンネル付き PNG (対象 image と同サイズ・50MB 未満) で部分編集 (inpainting)
- **`input_fidelity`**: `high`/`low` — 入力画像への忠実度制御。**gpt-image-2 ではパラメータ指定不可 (常に高忠実で自動処理、省略必須)**。gpt-image-1/1.5 では `high` 指定で顔・ロゴ等を保持
- gpt-image-2 は「指示した箇所だけ変更し、ライティング・構図・人物の見た目を入出力で一貫保持する」ことを editing の売りにしている (公式発表)
- `prompt` 上限: GPT image 系 32,000 文字

## 4. 参照画像 1〜4 枚を入れた生成 — 可能 (事実)

公式ガイドに「**4 つの入力画像を使ってギフトバスケット画像を合成する**」例が `client.images.edit()` (images/edits) で掲載されている。Responses API でも入力画像を URL / base64 data URL / file_id で複数渡して生成可能。つまり「参照画像 1〜4 枚 + プロンプト → 新規画像」は images/edits が正式ルート。

- 出典: https://developers.openai.com/api/docs/guides/image-generation

## 5. 複数枚生成 (n パラメータ) — 可能

- `n`: **1〜10** (generations / edits とも。旧 dall-e-3 のみ n=1 制限だったが停止済み)
- 出典: https://developers.openai.com/api/reference/resources/images/methods/generate

## 6. サイズ / 品質 / その他パラメータ

- **size**: `auto` / `1024x1024` / `1536x1024` / `1024x1536`、さらに **gpt-image-2 はカスタム `WIDTHxHEIGHT` 対応** — 条件: 両辺 16px の倍数、最大辺 3840px、アスペクト比 3:1 以下、総ピクセル 655,360〜8,294,400 (≒2K 超高解像度対応)
- **quality**: `low` / `medium` / `high` / `auto`
- **background**: `transparent` / `opaque` / `auto` — **注意: gpt-image-2 は現時点で `transparent` 非対応** (公式ガイド明記: "gpt-image-2 doesn't currently support transparent backgrounds")。透明 PNG が要件なら gpt-image-1.5 (12/1 まで) か後処理での背景除去
- **output_format**: `png` (default) / `jpeg` / `webp`、**output_compression**: 0–100 (jpeg/webp)
- **moderation**: `auto` / `low`
- レスポンスは GPT image 系は常に base64 (`b64_json`)。URL 返却は旧 DALL-E のみだった
- 出典: 上記 API リファレンス 2 本 + 画像生成ガイド

## 7. 料金 (2026-07 公式 pricing ページ)

トークン課金 (per-image は公式 calculator による換算値):

| モデル | Text入力/1M | 画像入力/1M | 画像出力/1M | 1024², low/med/high の1枚概算 |
|---|---|---|---|---|
| gpt-image-2 | $5.00 | $8.00 | **$30.00** | **$0.006 / $0.053 / $0.211** |
| gpt-image-1.5 | $5.00 | $8.00 | $32.00 | $0.009 / $0.034 / $0.133 |
| gpt-image-1-mini | $2.00 | $2.50 | $8.00 | 最安 low ≒$0.005 |

注意点 (事実): gpt-image-2 は low が安くなった一方、**medium/high は gpt-image-1.5 より高い** ($0.053 vs $0.034、$0.211 vs $0.133) — 高解像アーキテクチャで 1 枚あたり出力トークン数が増えたため。編集時は入力画像分の画像入力トークン ($8/1M) が加算される。streaming の partial image は 1 枚につき +100 トークン。

- 出典: https://developers.openai.com/api/docs/pricing 、per-image 換算: 公式ガイド内 calculator + 第三者検証 https://evolink.ai/blog/chatgpt-image-2-release-date-2026 、 https://pricepertoken.com/gpt-image-pricing
- ※横長/縦長 (1536×1024 等) のサイズ別単価は calculator 抽出値に不確実性があるため、実装時に公式 calculator で再確認を推奨 (推測を含む)

## 8. レート制限 (gpt-image-2 / gpt-image-1.5 共通、公式モデルページ)

| Usage Tier | TPM | IPM (images/min) |
|---|---|---|
| Tier 1 | 100,000 | **5** |
| Tier 2 | 250,000 | 20 |
| Tier 3 | 800,000 | 50 |
| Tier 4 | 3,000,000 | 150 |
| Tier 5 | 8,000,000 | 250 |

- GPT image 系の利用には **API Organization Verification (組織認証) 完了が必須** (公式ガイド)
- 生成レイテンシ: 複雑なプロンプトで**最大 2 分** (公式ガイド) → Vercel の Route Handler は `maxDuration` 延長 (Fluid compute で最大 800s) か非同期ジョブ化が必要
- 出典: https://developers.openai.com/api/docs/models/gpt-image-2 、 https://developers.openai.com/api/docs/models/gpt-image-1.5

## 9. gpt-image-2 の特徴 (発表情報、第三者報道含む)

- 生成前に「Thinking」推論 + web 検索統合、テキストレンダリング精度 ~99% (文字レベル)、**日本語含む非ラテン文字の描画が大幅改善** (広告バナー/インフォグラフィック実用レベル) — 塗装会社 CMS のバナー/施工事例画像用途に直接効く
- Image Arena text-to-image リーダーボード初登場 1 位 (Elo 1507)
- 出典: https://gihyo.jp/article/2026/04/chatgpt-images-2.0 、 https://ai-revolution.co.jp/media/what-is-gpt-image-2/

## CMS (kumabe-tosou) への適用まとめ

- 施工写真のレタッチ: `images/edits` + gpt-image-2 (入力画像最大 16 枚、input_fidelity 自動高忠実) — **可能**
- 参照画像 1〜4 枚からの生成 (例: 施工前写真 + 色見本 → 完成イメージ): `images/edits` に複数 image を渡す — **可能 (公式例あり)**
- バリエーション複数枚: `n` (1〜10) — **可能**。ただし Tier 1 は 5 images/min なので UI 側でキュー制御必須
