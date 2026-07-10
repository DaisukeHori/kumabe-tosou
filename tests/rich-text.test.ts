import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderRichInline, renderRichText } from "@/components/site/rich-text";

/**
 * canonical: docs/design/visual-text-editor-v2.md §3.1 (マークアップ語彙) / §3.2
 * (パーサの安全性 = dangerouslySetInnerHTML 不使用で XSS 面ゼロ) / §5 Wave 0f。
 *
 * .test.ts の都合上 (vitest.config.ts の include は *.test.ts のみ) JSX は使わず
 * React.createElement 経由でラップして renderToStaticMarkup する
 * (tests/slot-text.test.ts に倣う)。renderRichText/renderRichInline は React.ReactNode を
 * 直接返すため、Fragment に包んでレンダーする。
 */

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node));
}

describe("renderRichText: mono (バッククォート)", () => {
  it("`text` を <span class=\"font-mono\"> に変換する", () => {
    const html = render(renderRichText("下地は#800で研ぎます。"));
    expect(html).not.toContain("font-mono");

    const html2 = render(renderRichText("下地は`#800`で研ぎます。"));
    expect(html2).toContain('<span class="font-mono">#800</span>');
    expect(html2).toContain("下地は");
    expect(html2).toContain("で研ぎます。");
  });
});

describe("renderRichText: strong (二重アスタリスク)", () => {
  it("**text** を <strong> に変換する", () => {
    const html = render(renderRichText("**強調**された文。"));
    expect(html).toContain("<strong>強調</strong>");
    expect(html).toContain("された文。");
  });
});

describe("renderRichText: link ([text](url))", () => {
  it("相対パス (/ 始まり) は next/link で描画する", () => {
    const html = render(renderRichText("[色見本](/colors)をご覧ください。"));
    expect(html).toContain('href="/colors"');
    expect(html).toContain(">色見本<");
  });

  it("http(s):// 始まりは target=_blank の外部リンクとして描画する", () => {
    const html = render(renderRichText("[外部](https://example.com)へのリンク。"));
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("mailto: は通常の <a> として描画する", () => {
    const html = render(renderRichText("[メール](mailto:test@example.com)"));
    expect(html).toContain('href="mailto:test@example.com"');
  });

  it("許可されないスキーム (javascript:) はリンク化せずリテラル文字列で描画する (XSS 防止の要)", () => {
    const html = render(renderRichText("[x](javascript:alert(1))"));
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    expect(html).toContain("[x](javascript:alert(1))");
  });

  it("許可されないスキーム (data:) もリンク化せずリテラル文字列で描画する", () => {
    const html = render(renderRichText("[y](data:text/html,<script>alert(1)</script>)"));
    expect(html).not.toContain("<a ");
    // data: URL 自体は許可しないため href 属性としては出力されない。
    // <script> はテキストとして React にエスケープされる (dangerouslySetInnerHTML 不使用の証明)。
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderRichText: XSS 不能性 (dangerouslySetInnerHTML 不使用)", () => {
  it("<script>alert(1)</script> を入力しても script 要素は生成されず文字列として表示される", () => {
    const html = render(renderRichText("<script>alert(1)</script>"));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("イベントハンドラ属性風の文字列もただのテキストとして描画される", () => {
    const html = render(renderRichText('<img src=x onerror="alert(1)">'));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("renderRichText: 段落・改行", () => {
  it("\\n\\n で段落 (<p>) に分割する", () => {
    const html = render(renderRichText("1段落目。\n\n2段落目。"));
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
    expect(html).toContain("1段落目。");
    expect(html).toContain("2段落目。");
  });

  it("段落内の単一改行 (\\n) は <br/> に変換する", () => {
    const html = render(renderRichText("1行目\n2行目"));
    expect((html.match(/<br\/?>/g) ?? []).length).toBe(1);
    expect(html).toContain("1行目");
    expect(html).toContain("2行目");
  });

  it("単一段落 (\\n\\n を含まない) でも <p> でラップする (公開 API renderRichText の既定挙動)", () => {
    const html = render(renderRichText("ただの一文。"));
    expect((html.match(/<p>/g) ?? []).length).toBe(1);
  });
});

describe("renderRichText: 未対応マーカーの安全な扱い", () => {
  it("閉じられていないバッククォートはエラーを起こさずリテラル描画される", () => {
    expect(() => render(renderRichText("これは`未閉じの文です。"))).not.toThrow();
    const html = render(renderRichText("これは`未閉じの文です。"));
    expect(html).toContain("これは`未閉じの文です。");
    expect(html).not.toContain("font-mono");
  });

  it("閉じられていない ** はエラーを起こさずリテラル描画される", () => {
    expect(() => render(renderRichText("これは**未閉じの強調です。"))).not.toThrow();
    const html = render(renderRichText("これは**未閉じの強調です。"));
    expect(html).toContain("これは**未閉じの強調です。");
    expect(html).not.toContain("<strong>");
  });
});

describe("renderRichInline: 単一段落インライン (<p> ラップなし)", () => {
  it("<p> を生成しない", () => {
    const html = render(renderRichInline("`#800`で研ぎ、**強調**します。"));
    expect(html).not.toContain("<p>");
    expect(html).toContain('<span class="font-mono">#800</span>');
    expect(html).toContain("<strong>強調</strong>");
  });

  it("段落内の単一改行は <br/> になる", () => {
    const html = render(renderRichInline("1行目\n2行目"));
    expect((html.match(/<br\/?>/g) ?? []).length).toBe(1);
  });
});

describe("renderRichText: XSS 敵対的検証 (tester 追加、突破を試みる)", () => {
  it("大文字スキーム [x](JAVASCRIPT:alert(1)) はリンク化されない", () => {
    const html = render(renderRichText("[x](JAVASCRIPT:alert(1))"));
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("制御文字混入 [x](java\\tscript:alert(1)) はリンク化されない", () => {
    const html = render(renderRichText("[x](java\tscript:alert(1))"));
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("先頭空白 [x]( javascript:alert(1)) はリンク化されない (相対パスパターン不一致)", () => {
    const html = render(renderRichText("[x]( javascript:alert(1))"));
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("vbscript: スキームはリンク化されない", () => {
    const html = render(renderRichText("[x](vbscript:alert(1))"));
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("data:text/html はリンク化されず、中身の <script> もエスケープされる", () => {
    const html = render(
      renderRichText("[y](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"),
    );
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("url に空白混入 [x](/path onmouseover=alert(1)) は相対パスパターンに一致せずリンク化されない (属性としては現れず、単なるテキストとして表示される)", () => {
    const html = render(renderRichText("[x](/path onmouseover=alert(1))"));
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
    // リテラルテキストとしては表示される (安全: HTML 属性ではなくテキストノード)。
    expect(html).toContain("[x](/path onmouseover=alert(1))");
  });

  it('url に "(ダブルクォート) を含む相対パスは許容されるが、href 属性値として安全にエスケープされ属性境界を破れない (React 標準エスケープ)', () => {
    const html = render(renderRichText('[x](/path"onmouseover=alert(1))'));
    // 相対パスパターン (^\/[^\s)]*$) には空白がないため一致し、リンク化される
    // (url キャプチャは最初の ")" 直前まで = "/path\"onmouseover=alert(1"、末尾の ")" はリテラルとして残る)。
    expect(html).toContain("<a ");
    // 生の (エスケープされていない) `"onmouseover=` が href 属性値の外へ露出していないこと。
    // React は属性値の " を &quot; にエスケープするため、生の文字列は出現しないはず。
    expect(html).not.toContain('href="/path"onmouseover=alert(1"');
    expect(html).toContain('href="/path&quot;onmouseover=alert(1"');
    // </a> の外側に、閉じ括弧のみがリテラルテキストとして残る (安全: 実行可能な属性ではない)。
    expect(html).toContain("</a>)");
  });

  it('url に <script> を含む相対パス (/"><script>alert(1)</script>) でも script 要素は生成されない', () => {
    const html = render(renderRichText('[x](/"><script>alert(1)</script>)'));
    // href 属性としてリンク化されうるが、生の <script> タグは決して出現しない
    // (React が < > " を全てエスケープするため)。
    expect(html).not.toMatch(/<script[ >]/);
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("バッククォート内の <img src=x onerror=alert(1)> は font-mono span のテキストとしてエスケープされ、img 要素は生成されない", () => {
    const html = render(renderRichText("`<img src=x onerror=alert(1)>`"));
    expect(html).toContain('<span class="font-mono">');
    expect(html).not.toMatch(/<img[ >]/);
    expect(html).toContain("&lt;img");
  });

  it("**<script>alert(1)</script>** は strong のテキストとしてエスケープされ script 要素は生成されない", () => {
    const html = render(renderRichText("**<script>alert(1)</script>**"));
    expect(html).toContain("<strong>");
    expect(html).not.toMatch(/<script[ >]/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("ネスト mono+strong `**a**` は内側マーカーをリテラルとして mono 表示する (ネストなし)", () => {
    const html = render(renderRichText("`**a**`"));
    expect(html).toContain('<span class="font-mono">**a**</span>');
    expect(html).not.toContain("<strong>");
  });

  it("ネスト link+strong [**b**](/x) はリンクテキストにリテラル ** を含む (ネストなし)", () => {
    const html = render(renderRichText("[**b**](/x)"));
    expect(html).toContain('href="/x"');
    expect(html).toContain(">**b**<");
    expect(html).not.toContain("<strong>");
  });

  it("連続バッククォート `a`b`c` は例外を投げず 2 つの mono span に分割される", () => {
    expect(() => render(renderRichText("`a`b`c`"))).not.toThrow();
    const html = render(renderRichText("`a`b`c`"));
    expect(html).toContain('<span class="font-mono">a</span>');
    expect(html).toContain('<span class="font-mono">c</span>');
  });

  it("href/onerror/onclick 等のリテラル属性文字列を大量に含む入力でも <script>/<img>/on* 属性実体は生成されない", () => {
    const evil =
      '"><svg/onload=alert(1)>`onmouseover=alert(2)`**"><iframe src=javascript:alert(3)>**[click](javascript:alert(4))';
    const html = render(renderRichText(evil));
    expect(html).not.toMatch(/<svg[ /]/);
    expect(html).not.toMatch(/<iframe[ >]/);
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<a ");
  });
});

describe("renderRichText: 複合 (mono + strong + link が同一テキストに混在)", () => {
  it("下地はどのグレードも共通です。#800 で積層痕を研ぎ落とし… の実例パターン", () => {
    const text =
      "下地はどのグレードも共通です。`#800`で積層痕を研ぎ落とし、プラサフで微細な段差を埋め、`#1200`で水研ぎ。**違いはトップコートの層数だけ**——詳しくは[色見本](/colors)をご覧ください。";
    const html = render(renderRichText(text));
    expect(html).toContain('<span class="font-mono">#800</span>');
    expect(html).toContain('<span class="font-mono">#1200</span>');
    expect(html).toContain("<strong>違いはトップコートの層数だけ</strong>");
    expect(html).toContain('href="/colors"');
    expect(html).toContain("下地はどのグレードも共通です。");
  });
});
