import type { CallHandling, CallTranscript } from "../contracts";

/**
 * 転写用語集 / 議事録生成プロンプト (canonical: docs/design/crm-suite/04-telephony.md §6.5.3)。
 * AI 呼び出しは全量 aiProvidersFacade 経由 (直 SDK import 禁止) — 本ファイルはプロンプト文字列の
 * 組み立てのみを担う純関数/定数で、AI 呼び出し自体は worker.ts が行う。
 */

/**
 * transcribe の `prompt` 引数に渡す転写用語集 (塗装業界固有名詞の補助)。
 * `aiProvidersFacade.transcribe` の req.prompt は zTranscribeReq で `max(1000)` 制約があるため
 * 1000 字を超えないこと。
 */
export const TERMINOLOGY_PROMPT =
  "以下は塗装工房への電話の文字起こしです。次のような専門用語が出てくることがあります: " +
  "ガンプラ、プラモデル、MG(マスターグレード)、RG(リアルグレード)、HG(ハイグレード)、" +
  "PG(パーフェクトグレード)、フィギュア、ジオラマ、エアブラシ塗装、缶スプレー、筆塗り、" +
  "パール仕上げ、キャンディ塗装、メタリック、つや消し(マット)、クリア塗装、下地処理、" +
  "サーフェイサー(サフ)、マスキング、上塗り、下塗り、ウレタン塗装、ラッカー塗装、" +
  "見積り、納期、着払い、代引き、塗装ブース、乾燥、研磨。" +
  "人名・地名・電話番号・型番は聞き取れたとおりに書き起こしてください。";

/**
 * 議事録生成 (`generateText`) の system プロンプト (§6.5.3)。
 * summary ≤ 400 字・key_points ≤ 8 件・tasks ≤ 5 件は実運用の出力目標であり、
 * zCallAnalysis のスキーマ上限 (summary 2000字・key_points 20件・tasks 10件) はあくまで
 * 暴走防止のための防御的上限であって生成目標ではないことを明記する。
 */
export const CALL_ANALYSIS_SYSTEM_PROMPT = `
あなたは塗装工房「隈部塗装」の電話番です。通話の文字起こし全文から、業務で使う議事録とタスク案を作成します。

- 文体は敬体 (です・ます調) で、簡潔にまとめてください。
- 人名・商品名・型番などの固有名詞は、転写された表記のまま使ってください (勝手に言い換えない)。
- summary は 400 字程度を目安に、通話の要旨を過不足なくまとめてください。
- key_points は 8 件程度までを目安に、重要な事実のみを箇条書きで挙げてください (雑談は含めない)。
- tasks は 5 件程度までを目安に、実際に対応が必要な行動 (折り返し電話・見積り作成など) のみを
  抽出してください。世間話や相槌のみのやり取りからタスクを作らないでください。
- 上記の字数・件数はあくまで実運用上の目安です。出力形式 (スキーマ) が許容する上限
  (summary 2000字・key_points 20件・tasks 10件) は暴走防止のための防御的な上限であり、
  生成の目標ではありません。目安を超えても構造上のエラーにはなりませんが、簡潔さを優先してください。
- 通話全文が無音・雑音のみ・内容が読み取れない場合は、その旨を summary に明記してください。
- 折り返し連絡が必要かどうかを callback_required で正確に判定してください。
`.trim();

const FULL_TEXT_MAX_CHARS = 50_000;
const JST_TIME_ZONE = "Asia/Tokyo";

const HANDLING_LABEL: Record<CallHandling, string> = {
  forwarded: "転送応答 (熊部さんが直接応答)",
  voicemail: "留守番電話 (営業時間内)",
  after_hours_voicemail: "留守番電話 (営業時間外)",
  missed: "不通 (録音なし)",
};

function formatJst(iso: string): string {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${formatter.format(new Date(iso))} (JST)`;
}

/** 「M分S秒」形式の通話時間表示 (§6.5.3 のプロンプト内表示 / §6.6 の activity title・body で共用)。 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "不明";
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${minutes}分${remainSeconds}秒`;
}

/** buildAnalysisPrompt に渡す通話メタ情報 (§6.5.3: 通話日時JST・handling・通話時間・発信番号の有無)。 */
export type CallAnalysisMeta = {
  /** calls.started_at (ISO8601、UTC 保存)。プロンプト内では JST 表示に変換する。 */
  startedAt: string;
  handling: CallHandling | null;
  durationSeconds: number | null;
  hasFromNumber: boolean;
};

/**
 * analyzing ステージの user プロンプトを組み立てる (§6.5.3)。
 * transcript.full_text は先頭 50,000 字に切り詰める (長大入力の暴走防止)。
 */
export function buildAnalysisPrompt(transcript: CallTranscript, callMeta: CallAnalysisMeta): string {
  const fullText = transcript.full_text.slice(0, FULL_TEXT_MAX_CHARS);
  const handlingLabel = callMeta.handling ? HANDLING_LABEL[callMeta.handling] : "不明";
  const fromLabel = callMeta.hasFromNumber ? "あり (発信者番号を確認済み)" : "非通知・不明";

  return [
    "以下は塗装工房にかかってきた電話 1 件分の情報です。この内容から議事録とタスク案を作成してください。",
    "",
    `通話日時: ${formatJst(callMeta.startedAt)}`,
    `対応種別: ${handlingLabel}`,
    `通話時間: ${formatDuration(callMeta.durationSeconds)}`,
    `発信者番号: ${fromLabel}`,
    "",
    "---- 通話全文 (チャネル別に連結。channel0=相手 / channel1=こちら。留守電はchannel0のみ) ----",
    fullText,
  ].join("\n");
}
