/**
 * KMB エラーコード体系 (canonical: docs/design/cms-ai-pipeline.md §9)。
 * ここが KmbErrorCode の実体 (as const 一覧)。
 * platform/contracts.ts の KmbErrorCode 型はこの一覧の keyof を再輸出する
 * (契約書 §4.1 の型注釈 `KMB-E${number}` はドキュメント上の簡略表記であり、
 *  実装では自動補完・網羅性チェックのため具体的なユニオン型を正とする)。
 *
 * message: admin 向けユーザー表示メッセージ
 * recovery: 復旧アクション (設計書 §9 の「復旧アクション」列と 1:1)
 */
export const KMB_ERRORS = {
  "KMB-E101": {
    category: "1xx 入力検証",
    message: "入力内容に誤りがあります。フォームの表示内容をご確認ください。",
    recovery: "フォームにフィールド単位で表示",
  },
  "KMB-E102": {
    category: "1xx 入力検証",
    message: "同じ slug / key がすでに使用されています。",
    recovery: "別の slug を提案表示",
  },
  "KMB-E103": {
    category: "1xx 入力検証",
    message: "他の人がこの内容を更新しています。最新の内容を確認してください。",
    recovery: "最新版との差分を提示し選択させる",
  },
  "KMB-E107": {
    category: "1xx 入力検証",
    message: "存在しないスロットが指定されました。",
    recovery: "再読み込み。registry と DB の整合を確認",
  },
  "KMB-E108": {
    category: "1xx 入力検証",
    message: "この画像はすでにこの施工事例に追加されています。",
    recovery: "別の画像を選ぶか、既存画像を先に削除",
  },
  "KMB-E109": {
    category: "1xx 入力検証",
    message: "対象が見つからないか、他の変更と競合しました。",
    recovery: "画面を再読み込みして最新の状態をご確認ください",
  },
  "KMB-E201": {
    category: "2xx 認証認可",
    message: "ログインが必要です。",
    recovery: "/admin/login へ",
  },
  "KMB-E202": {
    category: "2xx 認証認可",
    message: "この操作を行う権限がありません。",
    recovery: "権限確認の案内",
  },
  "KMB-E301": {
    category: "3xx メディア",
    message: "このメディアは他のコンテンツから参照されているため削除できません。",
    recovery: "参照元一覧を表示",
  },
  "KMB-E302": {
    category: "3xx メディア",
    message: "アップロードできる形式・サイズではありません。",
    recovery: "対応形式の案内",
  },
  "KMB-E303": {
    category: "3xx メディア",
    message: "音声が25MB / 15分の上限を超えています。",
    recovery: "分割の案内",
  },
  "KMB-E401": {
    category: "4xx AI",
    message: "AI 生成の呼び出しに失敗しました。",
    recovery: "内容修正の上再実行",
  },
  "KMB-E402": {
    category: "4xx AI",
    message: "AI サービスが一時的に利用できません。",
    recovery: "時間を置いて再実行",
  },
  "KMB-E403": {
    category: "4xx AI",
    message: "表現が原因で AI が生成を拒否しました。",
    recovery: "表現を変えて再実行",
  },
  "KMB-E404": {
    category: "4xx AI",
    message: "生成物が文字数・形式の制約を満たしていません。",
    recovery: "自動再生成 1 回 → 失敗なら手動",
  },
  "KMB-E405": {
    category: "4xx AI",
    message: "文字起こしに失敗しました。",
    recovery: "音声再アップロード or テキスト入力",
  },
  "KMB-E406": {
    category: "4xx AI",
    message: "整文処理が意味の変化を検出しました。原文のまま確認してください。",
    recovery: "raw_text のまま人間修正へフォールバック",
  },
  "KMB-E501": {
    category: "5xx 配信",
    message: "X への投稿でエラーが発生しました。",
    recovery: "detail 確認 → 手動リトライ",
  },
  "KMB-E502": {
    category: "5xx 配信",
    message: "Instagram への投稿でエラーが発生しました。",
    recovery: "detail 確認 → 手動リトライ",
  },
  "KMB-E503": {
    category: "5xx 配信",
    message: "チャネルの接続トークンが失効しています。",
    recovery: "チャネル再接続",
  },
  "KMB-E504": {
    category: "5xx 配信",
    message: "スレッド投稿が途中で失敗しました。",
    recovery: "続きから再開",
  },
  "KMB-E505": {
    category: "5xx 配信",
    message: "X の月間コスト上限に達しています。",
    recovery: "上限見直し or 翌月まで待機",
  },
  "KMB-E506": {
    category: "5xx 配信",
    message: "配信結果が確認できません。実際に投稿されたかご確認ください。",
    recovery: "manual_required へ。admin が SNS 上の実投稿を確認して手動確定",
  },
  "KMB-E901": {
    category: "9xx システム",
    message: "予期しないエラーが発生しました。",
    recovery: "ログ (Vercel) 確認",
  },
  "KMB-E902": {
    category: "9xx システム",
    message: "通知メールの送信に失敗しました (処理自体は成功しています)。",
    recovery: "ログのみ。問い合わせ保存・配信処理自体は成功扱い。ダッシュボードで未読確認",
  },
} as const satisfies Record<
  string,
  { category: string; message: string; recovery: string }
>;

export type KmbErrorCode = keyof typeof KMB_ERRORS;

export function getErrorInfo(code: KmbErrorCode) {
  return KMB_ERRORS[code];
}
