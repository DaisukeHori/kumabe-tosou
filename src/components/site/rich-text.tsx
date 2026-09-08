import Link from "next/link";

/**
 * `rich` kind (docs/design/visual-text-editor-v2.md §3) のマークアップパーサ。
 *
 * 語彙は 3 トークンのみ (§3.1):
 * - `` `text` `` (バッククォート囲み) → `<span className="font-mono">text</span>`
 * - `**text**` (二重アスタリスク囲み、text に `*` を含まない) → `<strong>text</strong>`
 * - `[text](url)` → 内部リンク (`/` 始まり) は `next/link`、外部 (`http(s)://`)・`mailto:` は
 *   `<a>`。それ以外のスキーム (`javascript:` / `data:` 等) はリンク化せず `[text](url)` を
 *   そのままリテラル文字列として描画する (XSS 対策の要)。
 * - 段落 (`\n\n`) と単一改行 (`\n` → `<br/>`) は multiline と同じ扱い。
 *
 * **安全性**: `dangerouslySetInnerHTML` は使わない。出力できる要素は
 * `<p>` / `<span className="font-mono">` / `<strong>` / `<br/>` / `<Link>` / `<a>` /
 * テキストノードのみ。className は固定リテラルのみ、href は下記の url 検証を通った文字列
 * のみを渡す。ユーザー入力が属性やタグとして解釈される経路は存在しない (生の `<` `>` `&` は
 * すべてテキストノードとして React が自動エスケープする)。
 */

const TOKEN_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\n]+)\)/g;

const RELATIVE_URL_RE = /^\/[^\s)]*$/;
const EXTERNAL_URL_RE = /^https?:\/\/[^\s)]+$/;
const MAILTO_URL_RE = /^mailto:[^\s)]+$/;

type LinkUrlKind = "relative" | "external" | "mailto";

/**
 * リンク描画の呼び出し側オプション。既定 (未指定) はこれまでと完全に同じ挙動で、
 * 他ページの描画結果は一切変わらない。
 *
 * `openLinksInNewTab`: contact フォームの同意チェックボックス
 * (contact.form.consent.text) 専用。`<label>` の中にリンクが入れ子になっているため、
 * リンクをクリックすると同一タブでプライバシーポリシーへ遷移し、入力中のフォーム内容が
 * すべて失われていた。別タブで開き、かつクリックを label へ伝播させない
 * (= チェック状態を変えない) ことで、入力を保ったままポリシーを確認できるようにする。
 */
export type RichInlineOptions = {
  openLinksInNewTab?: boolean;
};

/** label 内リンクのクリックが checkbox のトグルへ伝播しないようにする */
function stopClickPropagation(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.stopPropagation();
}

/** url が許可されたスキーム (相対 `/` / `http(s)://` / `mailto:`) に一致するか判定する */
function classifyLinkUrl(url: string): LinkUrlKind | null {
  if (RELATIVE_URL_RE.test(url)) return "relative";
  if (EXTERNAL_URL_RE.test(url)) return "external";
  if (MAILTO_URL_RE.test(url)) return "mailto";
  return null;
}

/** url 検証を通った場合のみリンク要素を返す。それ以外は null (呼び出し側がリテラル描画へ落とす) */
function renderLinkToken(
  key: string,
  text: string,
  url: string,
  options?: RichInlineOptions,
): React.ReactNode | null {
  const kind = classifyLinkUrl(url);
  // options 未指定時は onClick / target を一切付けない (既存ページの挙動を変えない)。
  const extra = options?.openLinksInNewTab
    ? ({ target: "_blank", rel: "noopener noreferrer", onClick: stopClickPropagation } as const)
    : undefined;
  if (kind === "relative") {
    return (
      <Link key={key} href={url} {...extra}>
        {text}
      </Link>
    );
  }
  if (kind === "external") {
    return (
      <a
        key={key}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={extra?.onClick}
      >
        {text}
      </a>
    );
  }
  if (kind === "mailto") {
    return (
      <a key={key} href={url} onClick={extra?.onClick}>
        {text}
      </a>
    );
  }
  return null;
}

/**
 * 1 行 (改行を含まない) をトークナイズして React ノード配列に変換する。
 * 未対応マーカー (閉じられていないバッククォート/`**`) はエラーにせず、素のテキストとして
 * 残す (React が自動エスケープするため安全)。
 */
function tokenizeLine(
  line: string,
  keyPrefix: string,
  options?: RichInlineOptions,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;
  TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-t${tokenIndex++}`;

    if (match[1] !== undefined) {
      // `text` → mono
      nodes.push(
        <span key={key} className="font-mono">
          {match[1]}
        </span>,
      );
    } else if (match[2] !== undefined) {
      // **text** → strong
      nodes.push(<strong key={key}>{match[2]}</strong>);
    } else if (match[3] !== undefined && match[4] !== undefined) {
      // [text](url) → link (検証失敗時はリテラル文字列 = match[0] のまま描画)
      nodes.push(renderLinkToken(key, match[3], match[4], options) ?? match[0]);
    }

    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes;
}

/**
 * 1 段落 (`\n\n` を含まない) をインライン装飾込みで React ノードへ変換する。
 * 段落内の単一改行 (`\n`) は `<br/>` に変換する。`<p>` ラップはしない
 * (SlotRichText が単一段落を inline flow に埋め込む用途、および単体テスト用に公開)。
 */
export function renderRichInline(
  paragraph: string,
  options?: RichInlineOptions,
): React.ReactNode {
  const lines = paragraph.split("\n");
  const nodes: React.ReactNode[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push(<br key={`br-${lineIndex}`} />);
    }
    nodes.push(...tokenizeLine(line, `l${lineIndex}`, options));
  });
  return nodes;
}

/**
 * `rich` マークアップ文字列全体を段落込みの React ノードへ変換する公開 API。
 * `\n\n` で段落分割し、各段落を `<p>` でラップする (multiline と同じ段落分割規則)。
 */
export function renderRichText(text: string, options?: RichInlineOptions): React.ReactNode {
  const paragraphs = text.split("\n\n");
  return paragraphs.map((paragraph, i) => (
    <p key={`p-${i}`}>{renderRichInline(paragraph, options)}</p>
  ));
}
