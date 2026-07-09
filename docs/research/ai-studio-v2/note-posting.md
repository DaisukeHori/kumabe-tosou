# note-posting [partial]

**推奨**: 現行の半自動方式 (コピー支援+note投稿画面を開く) を正とし、自動化するとしても「非公式APIによる下書き作成まで+手動公開」に留める (Cookie手動供給・半自動フォールバック必須、自動公開は不採用)

## リスク
- 公式APIが存在せず全手段が非公式。2026年だけでも reCAPTCHA v3 必須化 (5月)・コメントAPI v1 廃止 (春)・ProseMirror の合成イベント無効化 (5月) と破壊的変更が頻発しており、いつ全停止してもおかしくない
- クリエイター規約 10.1.7 (サーバー過負荷)・10.1.8 (運営妨害) 等の包括条項により運営判断で事前通知なくアカウント停止+売上金没収が可能 (自動化の明示的禁止条項はないが免罪符にならない)
- reCAPTCHA v3 によりスクリプトからの自動ログインは不可能。Cookie (~30日有効) の手動再供給が恒常運用コストになり、完全無人化は構造的に不可能
- Playwright 方式は UI 変更で突然死する実例あり (2026-05、1,325行スクリプト全滅)。かつ Vercel serverless 上では実行困難で別ワーカー (GitHub Actions/VPS) が必要
- ネット上の note API 解説には AI 生成のハルシネーション (存在しない api.note.com + Bearer token 等) が混入しており、実装時は DevTools での一次観測による検証が必須
- 自動公開まで行うとスパム認定・BAN リスクが跳ね上がる (下書き作成のみなら読者影響ゼロで相対的に低リスク)

---

## note.com への自動投稿手段 (2026年7月時点)

### 1. 公式 API — 存在しない (確定・一次情報)

- note 公式ヘルプに「**現在、noteが公式で公開しているAPIはありません。今後の公開予定も未定です**」と明記。ヘルプ記事: https://www.help-note.com/hc/ja/articles/46643492548121 (※同 URL と利用規約ページ https://terms.help-note.com/hc/ja/articles/44943817565465 は **bot アクセスに HTTP 403** を返し直接取得不可。文言は複数の二次ソースで一致確認: https://note.com/kawayasblog/n/n2fa8bfee9e3d 2025-10-03)
- 法人向け note pro (月額8万円) でも投稿 API は提供なし。GA4 連携・予約投稿・権限管理のみ (https://unique1.co.jp/column/public-relations/10911/)
- 公式に用意された機構は **RSS 出力と埋め込み (note→外部サイト方向のみ)**。外部→note 方向の公式手段はゼロ (https://note.com/kawayasblog/n/n2fa8bfee9e3d)

### 2. 非公式 API の現状 (2026年)

**認証方式 — 「X-Note-Session」というヘッダは実在せず。実体は Cookie セッション**:
- セッション Cookie `_note_session_v5` (+`note_gql_auth_token`)、書き込み系は `XSRF-TOKEN` cookie を URL デコードして `X-XSRF-TOKEN` ヘッダに載せる。加えて `X-Note-Client-Code` ヘッダが必須の系統あり (https://note.com/marie_222/n/n6a10366298b0 2026-05-11公開/05-22更新、https://note.com/a_g_e_n_t_b_o_t/n/n86da8314430b 2026-03-07)
- **2026年5月下旬の破壊的変更**: `POST /api/v1/sessions/sign_in` に `g_recaptcha_response` (reCAPTCHA v3 トークン) が必須化。**メール+パスワードでのスクリプト直ログインは事実上不可能に** (トークンなしだと成功風レスポンスだが Cookie が発行されない) (https://note.com/marie_222/n/n6a10366298b0)
- 現実解は「ブラウザ (または Playwright) でログイン→Cookie を抽出して保存」。**Cookie 有効期間は約30日** で定期再供給が必要 (https://note.com/a_g_e_n_t_b_o_t/n/n86da8314430b)

**投稿系エンドポイント (DevTools 観測ベース)**:
- 記事作成: `POST /api/v1/text_notes` (title/body 最小) → 下書き保存: `POST /api/v1/text_notes/draft_save?id={id}&is_temp_saved=true` の **2段階** (https://note.com/a_g_e_n_t_b_o_t/n/n86da8314430b)
- 公開: `PUT /api/v1/text_notes/{numeric_id}` (差分不可・フルペイロード必須)。別観測系統として `/api/v3/drafts` + `POST /api/v2/notes/{note_key}/publish` の報告もあり (https://note.com/marie_222/n/n6a10366298b0、https://note.com/googleaistudio/n/n93b23e79fba7 2025-06-20)
- 画像: `POST /api/v1/upload_image`、本文画像は S3 への2段階アップロード、見出し画像は multipart (MIME 明示必須) (https://note.com/marie_222/n/n6a10366298b0)
- 有料記事は非公開フィールド `pay_body` で可能との報告 (https://note.com/nori_nw/n/n60f8bcc34b80)
- **揺れに注意**: 2025年10月時点で投稿系が 405/アクセス拒否になったとの報告 (https://note.com/akawibaku137/n/nc154955d0220) がある一方、2026年3〜5月の記事では動作報告あり。コメント API v1 は2026年春に廃止 (空配列化) されるなど、**年数回ペースで予告なき破壊的変更が実際に起きている**
- **偽情報に注意**: Qiita 記事 (https://qiita.com/mistudio0902/items/f9e092ebe52e2b83c2e8) が主張する `POST https://api.note.com/v2.0/notes` + `Authorization: Bearer` 方式は他の全観測と矛盾し、AI 生成のハルシネーションの可能性が濃厚。実装時は DevTools での一次観測を正とすべき

**ライブラリ**:
- `NoteClient` (Selenium、PyPI 2023-10) → 後継 `NoteClient2` (Playwright ログイン+内部 API、Markdown/画像/アイキャッチ/有料/下書き/マガジン対応)。ただし **star 0・12 commits** で利用者・保守は極小 (https://github.com/Mr-SuperInsane/NoteClient2、https://nao-kun.com/?p=177)
- `note-mcp` (drillan): MCP サーバ。Playwright ログイン→Cookie を OS Keychain に暗号化保存、下書き作成・公開・S3 画像・Markdown→HTML 変換対応。207 commits と比較的活発。DISCLAIMER で「**10 req/分以下・自動連続投稿回避・アカウント停止リスク**」を明記 (https://github.com/drillan/note-mcp、https://github.com/drillan/note-mcp/issues/196)

### 3. Playwright / ブラウザ自動化の実現性

- **技術的には実現可能で実例多数** (2026年4〜6月に複数の完全ガイドあり)。ログイン維持は `launchPersistentContext` (プロファイル永続化) or storageState 保存で 2 回目以降パスワード不要 (https://qiita.com/akiraak/items/0b7de8642cbf72d81271、https://uravation.com/media/claude-code-note-auto-post/ 2026-04-25/05-28更新)
- **本文挿入の確定解はクリップボード書込み→Cmd+V 物理ペースト**。note のエディタは ProseMirror で、2026年5月の変更により合成 JS イベント (ClipboardEvent/execCommand/innerHTML) は全て無効化された。画像は `page.expect_file_chooser()` でネイティブダイアログを捕捉 (https://note.com/st_dev0/n/n2975c219c40a 2026-05-05 — 1,325行のスクリプトが UI 変更で突然死した実録)
- ガイドは `headless=False` での目視運用・1バッチ10〜20本以下・3秒以上の間隔を推奨 (https://uravation.com/media/claude-code-note-auto-post/)
- **[推測]** 本件 CMS (Vercel serverless) 上での Playwright 常駐は非現実的 (Chromium + 永続プロファイル + クリップボード操作が必要)。採用するなら GitHub Actions / ローカル / VPS の別ワーカーが必須 — これは一般的な Vercel 制約からの技術判断で、note 固有の出典はない

### 4. 「下書き作成だけ」なら — 可能・相対的に低リスク (実運用例あり)

- 非公式 API で「下書きの箱を確保→本文保存」の2段階フローによる下書き自動化の実運用例 (2026-05-24): 公開はあえて手動 (見出し画像の判断・Markdown 変換崩れ・公開タイミング判断のため) (https://note.com/jibun_updating/n/nd2eb96ca6255)
- note-mcp / NoteClient2 も下書き作成をサポート
- 下書きは自分にしか見えず読者影響ゼロのため、スパム認定リスクの観点でも公開自動化より大幅に安全 **[推測を含む評価]**

### 5. 規約・BAN リスク評価

- 利用規約に「自動化・スクレイピング・bot」の**明示的禁止条項はない**。ただし包括条項が広く解釈可能: **クリエイター利用規約 10.1.7 (サーバーへの過度な負荷) / 10.1.8 (運営妨害・広範解釈可) / 共通規約 13.1.7 (サービス妨害行為)** — 運営判断で予告なくアカウント停止可能 (https://github.com/drillan/note-mcp/issues/196 の条文分析。規約原文ページは bot に 403 のため直接確認不可 — この 403 自体が note のアンチボット姿勢の傍証)
- 規約違反時は**事前通知なしのアカウント停止+売上金没収**の運用実績あり (https://note.com/maki_note_maki/n/nb5e8fa743d9b、https://www.zero-pri.com/entry/note-account-ban)
- 実際の BAN 事例は情報商材・スパム的コンテンツ起因が大半で、**「低頻度の自動下書き作成」単体での BAN 報告は今回の調査では確認できず** (悪魔の証明であり保証ではない)。一方、note 運営が自動投稿を推奨しない姿勢 (投稿 API の 405 化観測など) は複数報告あり (https://note.com/akawibaku137/n/nc154955d0220)
- リスク総合評価: **下書き作成のみ・週数回・自アカウント → 低〜中**。**自動公開・大量投稿 → 中〜高** (note-mcp issue #196 も "Moderate to High (usage-dependent)" と同評価)

### 6. 本件 CMS への適用 (現状コード確認済み)

`/Users/horidaisuke/projects/kumabe-tosou/src/app/admin/channels/channel-posts-queue.tsx` および `connection-cards.tsx` を確認: 現行設計は既に **note = 半自動 (`manual_required`)** で、タイトル・本文・ハッシュタグの個別コピー + `https://note.com/notes/new` を新規タブで開く方式 (設計書 §8.3)。この設計は本調査結果と整合しており、規約・保守リスクを CMS 本体に持ち込まない点で妥当。

自動化度を上げる場合の唯一の現実的増分は「非公式 API による下書き作成」だが、(a) Cookie の手動供給 (~30日毎、reCAPTCHA v3 により無人更新不可)、(b) 年数回の破壊的変更への追従、(c) 失敗時の半自動フォールバック実装が必須になる。
