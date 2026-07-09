import { describe, expect, it } from "vitest";

import {
  contentEditableAttrs,
  slotEditableAttrs,
  workImageEditableAttrs,
} from "@/components/site/editable-attrs";

/**
 * canonical: docs/design/visual-media-editor.md §4.2 (data 属性は editMode===true の
 * ときだけ出力) / §1 (2 種別 + work_images の識別 data 属性) / §4.3 (公開 (site) ルートに
 * data-editable-* のコードパス自体が存在しないこと)。
 *
 * SlotImage / MediaCover / works 詳細ギャラリーの data 属性出し分けロジックは
 * editable-attrs.ts の純関数に切り出してあるため、React レンダリングを介さず
 * 直接ユニットテストできる (このリポジトリの vitest は jsdom 非依存の node 環境)。
 */

describe("slotEditableAttrs (SlotImage: ページスロット)", () => {
  const resolvedCustom = { mediaId: "11111111-1111-4111-8111-111111111111", isDefault: false };
  const resolvedDefault = { mediaId: null, isDefault: true };

  it("editMode=false のときは空オブジェクト (data 属性のコードパス自体が無い)", () => {
    expect(slotEditableAttrs("home.hero", resolvedCustom, false)).toEqual({});
    expect(slotEditableAttrs("home.hero", resolvedDefault, false)).toEqual({});
  });

  it("editMode=true かつ media_id 設定済みのとき、3 属性を出力する", () => {
    expect(slotEditableAttrs("home.hero", resolvedCustom, true)).toEqual({
      "data-editable-slot": "home.hero",
      "data-editable-media": "11111111-1111-4111-8111-111111111111",
      "data-editable-default": "false",
    });
  });

  it("editMode=true かつ既定 (media_id なし) のとき、data-editable-media は空文字", () => {
    expect(slotEditableAttrs("home.craft.1", resolvedDefault, true)).toEqual({
      "data-editable-slot": "home.craft.1",
      "data-editable-media": "",
      "data-editable-default": "true",
    });
  });
});

describe("contentEditableAttrs (MediaCover: コンテンツ画像 単一)", () => {
  const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
  const WORK_ID = "33333333-3333-4333-8333-333333333333";

  it("editMode=false のときは空オブジェクト", () => {
    expect(contentEditableAttrs("work", WORK_ID, MEDIA_ID, false)).toEqual({});
  });

  it("editMode=true のとき data-editable-content と data-editable-media を出力する", () => {
    expect(contentEditableAttrs("work", WORK_ID, MEDIA_ID, true)).toEqual({
      "data-editable-content": `work:${WORK_ID}:cover`,
      "data-editable-media": MEDIA_ID,
    });
  });

  it("mediaId=null (未設定) のとき data-editable-media は空文字", () => {
    expect(contentEditableAttrs("voice", WORK_ID, null, true)).toEqual({
      "data-editable-content": `voice:${WORK_ID}:cover`,
      "data-editable-media": "",
    });
  });

  it("kind='post' も同じ形式で出力する", () => {
    expect(contentEditableAttrs("post", WORK_ID, MEDIA_ID, true)).toEqual({
      "data-editable-content": `post:${WORK_ID}:cover`,
      "data-editable-media": MEDIA_ID,
    });
  });
});

describe("workImageEditableAttrs (works 詳細ギャラリー: work_images join 行)", () => {
  const WORK_ID = "44444444-4444-4444-8444-444444444444";
  const MEDIA_ID = "55555555-5555-4555-8555-555555555555";

  it("editMode=false のときは空オブジェクト", () => {
    expect(workImageEditableAttrs(WORK_ID, MEDIA_ID, false)).toEqual({});
  });

  it("editMode=true のとき data-editable-work-image のみを出力する (sort_order は出さない)", () => {
    const attrs = workImageEditableAttrs(WORK_ID, MEDIA_ID, true);
    expect(attrs).toEqual({
      "data-editable-work-image": `${WORK_ID}:${MEDIA_ID}`,
    });
    expect(Object.keys(attrs)).not.toContain("data-editable-media");
    expect(Object.keys(attrs)).not.toContain("sort_order");
  });
});
