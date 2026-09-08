/**
 * 同意チェックボックスのラベルクリック判定 (純関数)。
 *
 * 背景: base-ui の Checkbox の実体は aria-hidden の <input> で、<label htmlFor> の既定動作
 * ではトグルされない。そのため FieldLabel 側の onClick で明示的にトグルしている。
 * ただしラベル文中には「プライバシーポリシー」リンクが入れ子になっており、そこだけは
 * トグルせず別タブでポリシーを開く必要がある (入力内容を保ったまま確認できるようにするため)。
 *
 * 検証時の留意点 (検証担当の指摘の恒久化):
 * ラベルを「左上から数 px」のような固定座標や、リンク文字列を含む親要素の部分一致で
 * クリックすると、意図せずリンク側に当たって「チェックが入らない」ように見える。これは
 * 期待どおりの動作であり不具合ではない。E2E ではリンク以外の文字 (例: 「に同意する」) か
 * チェックボックス本体をクリックすること。この分岐は下記の純関数に集約してあり、
 * tests/contact-consent-label.test.ts が両方向 (リンク上=トグルしない /
 * リンク外=トグルする) を固定している。
 */

/** click イベントの target が持つ、判定に必要な最小インターフェース */
type ClosestCapable = { closest?: (selectors: string) => unknown };

/**
 * ラベル上のクリックでチェックをトグルしてよいか。
 * リンク (<a>) の内側なら false (リンクの既定動作 = 別タブでポリシーを開く を優先)。
 * target が取れない / closest を持たない場合は、同意できないほうが害が大きいため
 * トグルする側 (true) にフォールバックする。
 */
export function shouldToggleConsentFromLabelClick(target: unknown): boolean {
  if (!target || typeof target !== "object") return true;
  const closest = (target as ClosestCapable).closest;
  if (typeof closest !== "function") return true;
  return closest.call(target, "a") == null;
}
