# cli-token-reuse [blocked]

**推奨**: CLI の OAuth トークン流用は 3 社とも ToS 違反かつサーバー側で実効遮断・アカウント BAN 実績あり。kumabe-tosou のような本番アプリでは絶対に採用せず、各社の正規有料 API キー(Anthropic Console API キー / OpenAI Platform API キー / Gemini API キーまたは Vertex AI)を環境変数で使うこと。

## リスク
- Anthropic: サブスク OAuth トークン(sk-ant-oat01-...)を Claude Code 以外で使うのは Consumer Terms 違反。2026-02-19/20 に規約明文化+サーバー側で『This credential is only authorized for use with Claude Code』を返す実効遮断を実施。OpenCode 等は Anthropic の法的要請で対応を削除。アカウント BAN リスク大。
- Google: Gemini CLI の OAuth トークン(Code Assist API cloudcode-pa.googleapis.com 向け)をプロキシ流用する行為を 2026-02 に ToS 違反として明示、3/25 から検知強化。有料 Ultra($250/月)を含むアカウントを予告なし・返金なしで大量凍結した実績あり。
- OpenAI: Codex CLI の ChatGPT サブスク認証(~/.codex/auth.json、chatgpt.com バックエンド向け)は『personal development use のみ』が公式スタンス。プログラム的自動化には API キーを推奨。Consumer 規約で自動/プログラム的なデータ抽出を禁止しており、流用は規約違反リスク。
- 技術面が不安定: Claude Code のトークンは anthropic-beta: oauth-2025-04-20 ヘッダや Claude Code 偽装(User-Agent/system prompt)が前提で、Anthropic が仕様変更で頻繁に破壊(issue #13770 で 2.0.65 以降 400 error)。いつ動かなくなるか不定で本番依存不可。
- 各 CLI トークンは公開 Messages/Chat/Gemini API ではなく専用バックエンド(Code Assist API、ChatGPT backend、Claude Code 専用スコープ)に紐づき、レート制限もサブスク個人枠。CMS のサーバー間呼び出しに乗せると即座に異常トラフィック判定されやすい。
- トークンはユーザー個人のサブスクに紐づくため、他ユーザーのリクエストを自分の seat 経由で流すと Anthropic 公式が名指しで禁止する『someone else's request through your seat』に該当し、一発 BAN 対象。

---

## 調査論点: CLI OAuth トークンの自作アプリ流用 (2026 年 7 月時点)

対象: Claude Code / OpenAI Codex CLI / Gemini CLI の OAuth トークンを、kumabe-tosou (Next.js 15 + Supabase + Vercel の CMS) の API 呼び出しに流用できるか。技術的実現性と各社 ToS リスクを一次情報で検証した。

**結論を先に**: 3 社とも「技術的には偽装すれば一部叩けるが、ToS 違反であり、かつ 2026 年前半にサーバー側の実効遮断とアカウント BAN が実施済み」。本番 CMS に採用してはならない。以下、社別に事実を整理する。

---

### 1. Anthropic (Claude Code OAuth トークン)

**トークンの実体と技術仕様 (一次情報)**
- `claude setup-token` で 1 年間有効の長寿命 OAuth トークン (`sk-ant-oat01-...`) を発行できる。環境変数 `CLAUDE_CODE_OAUTH_TOKEN` にセットして CI 用途で使う想定。**「inference のみにスコープされ、Remote Control セッションは張れない」**と公式が明記。出典: [Claude Code 公式 Authentication ドキュメント](https://code.claude.com/docs/en/authentication)。
- macOS では Keychain、Linux/Windows では `~/.claude/.credentials.json` (mode 0600) に保存。同上一次情報。
- Messages API を直接叩く際の技術要件は Bearer 認証 + `anthropic-beta: oauth-2025-04-20`(および `claude-code-20250219`)ヘッダ、加えて Claude Code クライアントの偽装(User-Agent / "You are Claude Code" 系 system prompt の付与)。promptfoo 等の実装がこの方式を採る。

**技術的に「動かなくなっている」証拠**
- [anthropics/claude-code Issue #13770](https://github.com/anthropics/claude-code/issues/13770): Claude Code 2.0.65 以降が `anthropic-beta: oauth-2025-04-20` を自動注入し、全リクエストが **HTTP 400 `invalid_request_error` "Unexpected value(s) \`oauth-2025-04-20\` for the \`anthropic-beta\` header"`** で失敗する回帰。ヘッダ仕様が版ごとに揺れており、外部から安定的に叩ける保証がない。
- サードパーティ利用に対しては **サーバー側で `"This credential is only authorized for use with Claude Code"` を返す実効遮断**を導入済み(2026 年前半)。OpenCode は 2026-03-19 に Anthropic の法的要請で組み込み Anthropic 認証を削除。出典: [yage.ai 分析](https://yage.ai/share/claude-code-subscription-not-a-developer-credential-en-20260321.html)。

**ToS (最重要)**
- Anthropic は 2026-02-19/20 に規約を明文化: **「Free, Pro, Max プランで得た OAuth トークンを、Agent SDK を含む他のいかなる product / tool / service で使うことも許可しない (not permitted)」**。これは Consumer Terms of Service 違反に該当。開発者は Claude Console の API キーまたはサポートされたクラウドプロバイダを使えと明示。出典: [The Register 2026-02-20](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)、[Claude Code Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)。
- OpenClaw / OpenCode / Roo Code / Goose 等がトークン抽出で BAN・遮断された前例あり。**「他人のリクエストを自分の seat 経由で流した瞬間に API キーへ切り替えよ」**が公式スタンス。

**判定**: 技術的に不安定(Anthropic が能動的に破壊中)+ ToS 明確違反 + BAN リスク。本番不可。

---

### 2. OpenAI (Codex CLI / ChatGPT サブスクトークン)

**トークンの実体と技術仕様 (一次情報)**
- Codex CLI は 2 系統: 「Sign in with ChatGPT (サブスクアクセス)」と「API key (従量課金)」。ChatGPT ログイン時のトークンは **プレーンテキストの `~/.codex/auth.json`**(または OS credential store)にキャッシュ。出典: [Codex 公式 Authentication](https://developers.openai.com/codex/auth)。
- ChatGPT セッションはトークンを自動リフレッシュ(401 時に refresh-and-retry)し、`auth.json` に新トークンと `last_refresh` を書き戻す。
- ChatGPT サブスクトークンは公開 `api.openai.com` ではなく **ChatGPT バックエンド(chatgpt.com/backend-api/codex の responses エンドポイント)** に紐づく。標準 API とはエンドポイント・課金体系が別。

**技術的流用の実態**
- サードパーティ [opencode-openai-codex-auth プラグイン](https://github.com/numman-ali/opencode-openai-codex-auth)が「ChatGPT Plus/Pro の公式 OAuth フロー」でこのトークンを流用し GPT-5.2 系を叩く実装を公開。ただしプラグイン自身が **「personal development use のみ。production / multi-user では OpenAI Platform API を使え」**と明記。

**ToS**
- OpenAI 公式は **「プログラム的な Codex CLI ワークフロー(CI/CD 等)には API キー認証を推奨」**とし、ChatGPT サブスク認証をプログラム自動化から遠ざけている。出典: [Codex 公式 Authentication](https://developers.openai.com/codex/auth)。
- Consumer 向け規約は **「サービスの Output を自動的/プログラム的に抽出してはならない」**と規定。ChatGPT Plus/Pro は Consumer 扱いで、API 用途の Services Agreement とは別枠。出典: [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/)、[Usage policies](https://openai.com/policies/usage-policies/)。
- Anthropic/Google ほど派手な公開 BAN 報道は現時点で確認できないが、規約上は個人サブスクの外部アプリ流用は禁止方向で、リスクは同質。

**判定**: 技術的には流用可だが「personal use のみ」が公式・コミュニティ双方の共通認識。本番アプリでは API キー一択。

---

### 3. Google (Gemini CLI OAuth トークン)

**トークンの実体と技術仕様 (一次情報)**
- Gemini CLI は個人 Google アカウントで OAuth ログインすると、トークンを `~/.gemini/`(tokens.json 等)にキャッシュし、**公開 Gemini API ではなく Code Assist API (`cloudcode-pa.googleapis.com`)** に対して認証する。無料枠は個人アカウントで最大 1,000 requests/user/day。出典: [Gemini CLI Quotas and pricing](https://geminicli.com/docs/resources/quota-and-pricing/)。
- このトークンは Gemini CLI / IDE プラグイン / Google Antigravity 用のファーストパーティ設計で、再利用を意図していない。

**ToS と BAN 実績 (最重要)**
- Google は **2026 年 2 月に、Gemini CLI の OAuth トークンをプロキシ経由で流用する行為を明示的に ToS 違反と規定**。検知は 2026-03-25 から強化。**予告・猶予・返金なしで、有料 AI Ultra($250/月)を含むアカウントを大量凍結**した。OpenClaw + OAuth プラグインで Antigravity バックエンドにトラフィックを流していた利用者が主対象で、Google の自動検知が "malicious usage" と判定。出典: [WinBuzzer 2026-02-23](https://winbuzzer.com/2026/02/23/google-bans-ai-subscribers-openclaw-no-refunds-xcxwbn/)、[Implicator.ai](https://www.implicator.ai/google-restricts-ai-ultra-subscribers-over-openclaw-oauth-days-after-anthropic-ban/)、[MLQ News](https://mlq.ai/news/google-enforces-tos-bans-on-paid-antigravity-subscribers-using-openclaw-tool/)。
- Google は「ゼロトレランスで不可逆」と表明。年払いプリペイド利用者に救済なし。

**判定**: 3 社中もっとも強硬。技術的流用可だが、実 BAN が最も明確に発生済み。本番不可。

---

### 横断まとめ表

| 項目 | Claude Code | OpenAI Codex CLI | Gemini CLI |
|---|---|---|---|
| トークン保管 | Keychain / `~/.claude/.credentials.json` | `~/.codex/auth.json` (plaintext) | `~/.gemini/` |
| 叩く先 | Claude Code 専用スコープ (Messages API を偽装経由) | chatgpt.com backend (responses) | Code Assist API `cloudcode-pa.googleapis.com` |
| 技術的流用 | 偽装ヘッダ+system prompt 必要、版ごとに破壊される | プラグインで可(personal 限定) | プロキシで可 |
| サーバー側遮断 | あり(`only authorized for use with Claude Code`) | 明示遮断報告は限定的 | あり(検知 2026-03-25〜) |
| 公開 BAN 実績 | あり(OpenClaw/OpenCode 等) | 目立った公開 BAN は未確認 | あり(有料 Ultra 含む大量凍結) |
| ToS 明文化 | 2026-02-19/20 | Consumer 規約 + 公式「API キー推奨」 | 2026-02 |
| 本番採用可否 | 不可 | 不可 | 不可 |

---

### kumabe-tosou (本番 CMS) への具体的推奨

1. **CLI トークン流用は設計から除外する。** 3 社とも ToS 違反かつ BAN 実績があり、Vercel サーバーレスからサブスク個人トークンでサーバー間呼び出しをすれば即座に異常トラフィック判定される。
2. **正規の有料 API キーを使う。**
   - Anthropic: Claude Console で発行した API キー(`ANTHROPIC_API_KEY`)。Vercel 環境変数に格納。
   - OpenAI: OpenAI Platform の API キー。
   - Google: Gemini API キー、または本番規模なら Vertex AI(GCP プロジェクト+サービスアカウント)。
3. **鍵は必ずサーバー側(Route Handler / Server Action / Supabase Edge Function)に置き、クライアントに露出させない。** CMS なので RSC / API Route 経由の呼び出しが自然。
4. これらは従量課金だが、ToS 準拠・安定 SLA・レート制限が明確という点で、本番の唯一の正解。

出典一覧: [Claude Code Authentication](https://code.claude.com/docs/en/authentication) / [Issue #13770](https://github.com/anthropics/claude-code/issues/13770) / [The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/) / [yage.ai](https://yage.ai/share/claude-code-subscription-not-a-developer-credential-en-20260321.html) / [Claude Code Legal](https://code.claude.com/docs/en/legal-and-compliance) / [OpenAI Codex Auth](https://developers.openai.com/codex/auth) / [opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth) / [OpenAI Terms of Use](https://openai.com/policies/row-terms-of-use/) / [Gemini CLI Quotas](https://geminicli.com/docs/resources/quota-and-pricing/) / [WinBuzzer](https://winbuzzer.com/2026/02/23/google-bans-ai-subscribers-openclaw-no-refunds-xcxwbn/) / [Implicator.ai](https://www.implicator.ai/google-restricts-ai-ultra-subscribers-over-openclaw-oauth-days-after-anthropic-ban/)

**推測と事実の区別**: OpenAI の「公開 BAN 実績が限定的」は 2026-07 時点の報道で目立った事例を確認できなかったという事実観察であり、「BAN されない」ことの保証ではない(規約上は禁止方向)。Anthropic/Google の BAN・規約明文化・サーバー側遮断はいずれも一次〜二次情報で確認済みの事実。
