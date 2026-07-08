/**
 * "use server" ファイル (actions.ts) は関数以外を export できないため、
 * 型 + 初期値はこの非 "use server" ファイルに切り出す。
 */
export type SettingsFormState = { error: string | null; conflict: boolean; success: boolean };

export const SETTINGS_FORM_INITIAL_STATE: SettingsFormState = {
  error: null,
  conflict: false,
  success: false,
};
