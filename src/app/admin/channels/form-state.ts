/**
 * "use server" ファイル (actions.ts) はトップレベル export を async 関数のみに限定する
 * Next.js の制約があるため、初期状態の定数/型は settings モジュールと同じく別ファイルに置く
 * (src/app/admin/settings/form-state.ts と同じパターン)。
 */
export type ChannelsFormState = { error: string | null; success: boolean };

export const CHANNELS_FORM_INITIAL_STATE: ChannelsFormState = { error: null, success: false };
