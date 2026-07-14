import type { Brief, ChannelStyleProfile, ResearchNotes } from "../contracts";
import type { Channel } from "@/modules/platform/contracts";

/**
 * canonical: docs/design/cms-ai-pipeline.md §7.4 (プロンプト設計方針)。
 *
 * BRAND_SYSTEM_PROMPT は固定文字列 (変数を一切含まない) にすること
 * (§7.2: プロンプトキャッシュの cache_control:ephemeral を先頭ブロックに
 * 効かせるため、可変部を混ぜてはいけない)。
 */
export const BRAND_SYSTEM_PROMPT = `あなたは福岡県の自動車・小物塗装専門店「隈部塗装」のコンテンツ制作アシスタントです。

# 事業内容
- 自動車パーツ・小物・フィギュア等の塗装・カラーリング・修理を手がける専門店。
- 一人称は「私たち」「隈部塗装」。職人としての実直さ・丁寧さを大切にする。

# 禁止事項 (絶対に破らないこと)
- 誇大広告・効果保証・他社比較の表現を書かない。
- 事実でないことを書かない。話者の発言・提供されたリサーチ結果に無い事実を
  勝手に作り出さない (ハルシネーション禁止)。
- 引用元がある情報を書く場合は、その情報が research 由来であることを
  claims 出力の source フィールドで必ず明示する。

# 用語集
- ソウルレッド / プライマー / 耐候クリア 等の専門用語は正しい表記を維持する。

# 出力について
- 全ての出力は構造化スキーマ (JSON Schema) に厳密に従うこと。
- 生成した文の中で、話者の発言に直接由来しない文 (推測・一般論での補完) には
  claims 配列で source: "inference" を付けること。これは差分表示 (レビュー画面) で
  人間が重点確認するためのマーカーとして使われる。`;

export function buildCleanUserPrompt(rawText: string): string {
  return `以下は音声文字起こし (or 手入力) の生テキストです。フィラー除去・句読点付与・
明らかな誤認識の訂正のみを行い、意味の追加・削除は一切行わないでください。
意味が変わった可能性がある場合は meaning_preserved を false にしてください。

# 原文
${rawText}`;
}

export function buildExtractUserPrompt(cleanedText: string): string {
  return `以下のテキストから、コンテンツ制作のための要旨を抽出してください。
主題 (theme)、トピック一覧 (topics)、想定読者 (audience)、キーワード (keywords)、
話者が実際に述べた事実の主張一覧 (claims、source は "speech" とする) を出力してください。

# 対象テキスト
${cleanedText}`;
}

export function buildResearchUserPrompt(brief: Brief): string {
  return `以下の要旨に含まれる事実主張を補強・裏取りするため、Web検索を使って
関連する事実・訂正候補を調査してください。引用元 URL を必ず含めてください。

# 主題
${brief.theme}

# トピック
${brief.topics.join(", ")}

# 話者の事実主張
${brief.claims.map((c) => `- ${c.text}`).join("\n")}`;
}

/**
 * Issue #20: style (tone_instructions/format_rules/example_output) は呼び出し元
 * (facade.ts runOneStage の drafting ステージ・regenerateDraft) が ai_runs.style_profiles
 * (startRun 時点で確定させた DistributionFacade.getStyleProfiles() の結果) から
 * チャネル別に取り出して渡す。本関数内でチャネルから既定値を逆引きすることはしない
 * (旧 DEFAULT_STYLE_PROFILES ハードコードの解消)。
 */
export function buildDraftUserPrompt(
  channel: Channel,
  brief: Brief,
  researchNotes: ResearchNotes | null,
  instruction: string | null,
  style: ChannelStyleProfile,
): string {
  const researchBlock = researchNotes
    ? `\n# リサーチ結果 (引用付き事実)\n${researchNotes.facts
        .map((f) => `- ${f.text} (出典: ${f.url})`)
        .join("\n")}`
    : "\n# リサーチ結果\n(このrunではリサーチを実施していません)";
  const instructionBlock = instruction ? `\n# 追加の修正指示\n${instruction}` : "";
  // cms-ai-pipeline.md §2.2 style_profiles.example_output: 「few-shot 用のお手本」。
  // 文体・構成の参考として提示するのみで、内容の複製・引用元にはしない (system の
  // ハルシネーション禁止/事実主張ルールと矛盾しないよう明示する)。
  const exampleBlock = style.example_output
    ? `\n# お手本 (文体・構成の参考。この文章自体を書き写すのではなく、トーンと構成の近さの目安にすること)\n${style.example_output}`
    : "";

  return `以下の要旨をもとに、チャネル「${channel}」向けのコンテンツを生成してください。

# 文体・構成ルール
- トーン: ${style.tone_instructions}
- 構成: ${style.format_rules}

# 主題
${brief.theme}

# トピック
${brief.topics.join(", ")}

# 対象読者
${brief.audience}

# キーワード
${brief.keywords.join(", ")}

# 話者の事実主張
${brief.claims.map((c) => `- ${c.text}`).join("\n")}
${researchBlock}${instructionBlock}${exampleBlock}

content と claims (この生成で新たに使った事実主張。source は speech/research/inference から選ぶ)
を同時に出力してください。`;
}

/**
 * P4 (ai-studio-v2.md §7): image_generation ステージ用。生成済みの SNS 向け本文から
 * 「本文に合う画像の生成プロンプト」を 1 件だけ起案させる。sourceText は X スレッド全文 or
 * Instagram キャプション (facade.ts buildImagePromptSourceText 参照)。
 */
export function buildSnsImagePromptUserPrompt(sourceText: string): string {
  return `以下はSNS投稿用に生成された文章です。この内容に合う、投稿に添える写真的な画像を
生成するための画像生成プロンプトを1つ提案してください (英語表記。写実的な写真の描写に留め、
文字・ロゴ・透かしを含めないでください)。

# 投稿文章
${sourceText}`;
}
