/**
 * "use server" ファイル (actions.ts) は関数以外を export できないため、
 * 型 + 初期値はこの非 "use server" ファイルに切り出す。
 */
export type SettingsFormState = {
  error: string | null;
  conflict: boolean;
  success: boolean;
  /**
   * 保存自体は成功したが利用者に伝えるべき注意 (issue #47、05-site-settings.md §6.2):
   * favicon 非正方形/128px未満・OG 画像の推奨縦横比逸脱・OG 画像の JPEG ensure 失敗。
   * optional — 既存 5 Action (updateCompanySettingsAction 等) は submitSettingsForm の
   * 戻り値をそのまま返すため常に undefined (後方互換。既存フォームの初期状態を変えない)。
   */
  warning?: string | null;
};

export const SETTINGS_FORM_INITIAL_STATE: SettingsFormState = {
  error: null,
  conflict: false,
  success: false,
  // warning は省略 (undefined) — 既存フォームの初期状態を変えない
};
