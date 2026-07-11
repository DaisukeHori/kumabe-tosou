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
  "KMB-E105": {
    category: "1xx 入力検証",
    message: "送信レート制限を超えました (公開フォーム 5 件/時)。",
    recovery: "時間を置いて再送してください",
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
  "KMB-E407": {
    category: "4xx AI",
    message: "AI の月次予算上限 (または画像枚数上限) に達しています。",
    recovery: "設定画面で予算/上限を見直すか、翌月まで待機",
  },
  "KMB-E408": {
    category: "4xx AI",
    message: "AI プロバイダの呼び出しに失敗しました (登録済みキーをすべて試行しましたが失敗しました)。",
    recovery: "detail (最後のエラー分類) を確認。キーの状態を設定画面で確認",
  },
  "KMB-E409": {
    category: "4xx AI",
    message: "note セッションが無効または失効しています。",
    recovery: "設定画面から note セッション Cookie を再登録",
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

  // ---------- CRM スイート (00-overview.md §3.3 が採番 canonical) ----------

  "KMB-E601": {
    category: "6xx CRM",
    message: "似ている顧客がすでに登録されています。",
    recovery: "候補を確認し、既存を開くか統合する。force 指定で強制作成も可",
  },
  "KMB-E602": {
    category: "6xx CRM",
    message: "この状態からは変更できません。",
    recovery: "終端 (入金済み/失注) は変更不可。失注は「失注にする」(理由入力) から",
  },
  "KMB-E603": {
    category: "6xx CRM",
    message: "紐づけ先が見つかりません。",
    recovery: "一覧を再読み込みして対象を選び直す",
  },
  "KMB-E604": {
    category: "6xx CRM",
    message: "記録の形式が不正です。",
    recovery: "発生源モジュールの不具合。ログの detail を確認 (admin 操作では通常発生しない)",
  },
  "KMB-E605": {
    category: "6xx CRM",
    message: "この記録は編集できません (メモのみ編集可)。",
    recovery: "訂正はメモを追記する",
  },
  "KMB-E606": {
    category: "6xx CRM",
    message: "取り消し済みのやることは変更できません。",
    recovery: "必要なら新しいやることを作成",
  },
  "KMB-E607": {
    category: "6xx CRM",
    message: "メールアドレスか電話番号のどちらかが必要です。",
    recovery: "連絡先を入力して再送",
  },
  "KMB-E608": {
    category: "6xx CRM",
    message: "この組み合わせでは統合できません。",
    recovery: "統合済み顧客は選べません。統合先 (残す側) を確認",
  },

  "KMB-E620": {
    category: "6xx 受注・帳票",
    message: "明細がありません。",
    recovery: "明細を 1 行以上入力してから発行 (シミュレーター原案の XL は個別見積の明細化が先)",
  },
  "KMB-E621": {
    category: "6xx 受注・帳票",
    message: "この状態ではその操作はできません。",
    recovery:
      "detail の現在状態を確認。画面を再読み込みして最新状態を確認。取消済みは一切変更不可。入金済みの請求書の取消は、先に入金記録を全削除して発行済みに戻してから",
  },
  "KMB-E622": {
    category: "6xx 受注・帳票",
    message: "書類番号の発行に失敗しました。",
    recovery: "再試行 (新しい番号で採番し直される。欠番は許容)",
  },
  "KMB-E623": {
    category: "6xx 受注・帳票",
    message: "この書類からは作成できません。",
    recovery: "派生元が発行済み (または承諾済み) か確認。入金は請求書にのみ記録可",
  },
  "KMB-E624": {
    category: "6xx 受注・帳票",
    message: "発行済みの帳票は変更できません。",
    recovery: "「訂正発行」(内容の差し替え) または「取消 + 再作成」から行う",
  },
  "KMB-E625": {
    category: "6xx 受注・帳票",
    message: "入金合計が請求金額を超えます。",
    recovery: "detail の残高を確認して金額を修正",
  },
  "KMB-E626": {
    category: "6xx 受注・帳票",
    message: "請求書発行者の設定が必要です。",
    recovery: "サイト設定「請求書発行者」タブで発行者名を保存してから発行",
  },
  "KMB-E627": {
    category: "6xx 受注・帳票",
    message: "発行控えの記録に不整合があります。",
    recovery: "「再出力 (版+1)」で回復を試す。解消しない場合は detail を添えて開発者へ",
  },
  "KMB-E640": {
    category: "6xx 帳票PDF",
    message: "PDF の作成に失敗しました。",
    recovery: "再試行。detail が env 未設定 (PRINT_TOKEN_SECRET / SERVICE_ROLE_KEY) を示す場合は設定が先",
  },
  "KMB-E641": {
    category: "6xx 帳票PDF",
    message: "PDF の保存に失敗しました。",
    recovery: "再試行 (保存パスは版ごとに一意)。続く場合は Storage 状態を開発者へ",
  },
  "KMB-E642": {
    category: "6xx 帳票PDF",
    message: "このプレビューの有効期限が切れました。",
    recovery: "帳票画面から「印刷プレビュー」を開き直す (TTL 5 分・1 回限り)",
  },
  "KMB-E643": {
    category: "6xx 帳票PDF",
    message: "PDF を作成中です。しばらくしてからもう一度お試しください。",
    recovery: "数秒〜十数秒後に再試行 (グローバル同時実行 1)",
  },

  "KMB-E701": {
    category: "7xx 作業・カレンダー",
    message: "開始と終了を見直してください。",
    recovery: "開始時刻が終了時刻より前になるよう入力し直す",
  },
  "KMB-E702": {
    category: "7xx 作業・カレンダー",
    message: "使用中または無効な種別です。",
    recovery: "無効化するか別の種別を選んでください",
  },
  "KMB-E703": {
    category: "7xx 作業・カレンダー",
    message: "この状態では実行できません。",
    recovery: "現在状態を確認。外部未削除の予定が残る場合は外部カレンダーへの反映を待つ",
  },
  "KMB-E704": {
    category: "7xx 作業・カレンダー",
    message: "段取りを自動生成できませんでした。",
    recovery: "テンプレートを登録するか手動で作成してください",
  },
  "KMB-E705": {
    category: "7xx 作業・カレンダー",
    message: "先にカレンダーへ配置してから実績を入れてください。",
    recovery: "未配置・キャンセル済みのブロックには実績を入力できません",
  },
  "KMB-E720": {
    category: "7xx 外部同期",
    message: "カレンダーの再連携が必要です。",
    recovery: "connections 画面の再連携ボタンから再連携",
  },
  "KMB-E721": {
    category: "7xx 外部同期",
    message: "外部カレンダーとの書込みが競合しました。",
    recovery: "自動解決 (次回同期で外部変更を取り込んでから再送)",
  },
  "KMB-E722": {
    category: "7xx 外部同期",
    message: "カレンダー同期のトークンが失効しました。",
    recovery: "自動でフル再同期を実行",
  },
  "KMB-E723": {
    category: "7xx 外部同期",
    message: "外部カレンダーとの同期に失敗しました。",
    recovery: "「再送」または「作り直す」から復旧。クライアントシークレット失効時は env 更新が必要",
  },
  "KMB-E724": {
    category: "7xx 外部同期",
    message: "外部カレンダーへの反映結果を確認できませんでした。",
    recovery: "「照合して再開」から手動で解決 (自動では再開しない)",
  },
  "KMB-E725": {
    category: "7xx 外部同期",
    message: "同期処理を安全のため中断しました。",
    recovery: "日次メンテナンスで自動的に復旧します",
  },

  "KMB-E801": {
    category: "8xx 通話",
    message: "電話サービスからの通知の署名検証に失敗しました。",
    recovery: "不正リクエストの可能性。頻発時は BASE_URL 設定と Twilio AuthToken の一致を確認",
  },
  "KMB-E802": {
    category: "8xx 通話",
    message: "電話連携が未設定です。",
    recovery: "設定画面のセットアップチェックリストに従って env・番号・webhook を設定",
  },
  "KMB-E803": {
    category: "8xx 通話",
    message: "電話サービスからの通知の内容が想定と異なります。",
    recovery: "detail のパラメータ名を確認。Twilio 仕様変更の可能性 → 開発者へ",
  },
  "KMB-E804": {
    category: "8xx 通話",
    message: "対象の通話が見つかりません。",
    recovery: "画面を再読み込み",
  },
  "KMB-E805": {
    category: "8xx 通話",
    message: "録音の取得または保存に失敗しました。",
    recovery: "自動で最大 3 回再試行されます。失敗が続く場合は Twilio 側の録音有無を確認",
  },
  "KMB-E806": {
    category: "8xx 通話",
    message: "通話の後処理が 3 回失敗しました。",
    recovery: "詳細画面の「再実行」で最初からやり直せます。detail の直近エラーを確認",
  },
  "KMB-E807": {
    category: "8xx 通話",
    message: "このジョブは再実行できません (失敗状態のジョブのみ再実行できます)。",
    recovery: "処理中は完了を待つ。完了済みはやり直し不要",
  },
  "KMB-E820": {
    category: "8xx 転写・議事録",
    message: "文字起こしに失敗しました (分割後の再試行も失敗)。",
    recovery: "「再実行」で再試行、続く場合は録音を聞いて手動でメモ",
  },
  "KMB-E821": {
    category: "8xx 転写・議事録",
    message: "議事録の生成結果が不正です (AI 出力が契約と不一致、または生成拒否)。",
    recovery: "自動再生成 1 回済み。「再実行」で再試行、続く場合は全文タブから手動要約",
  },
  "KMB-E822": {
    category: "8xx 転写・議事録",
    message: "録音が処理上限を超えています (長さ・形式の制約)。",
    recovery: "録音の再生は可能。上限 (AI 処理する録音長) は設定画面で変更可",
  },
  "KMB-E823": {
    category: "8xx 転写・議事録",
    message: "同じ電話番号の顧客が複数見つかりました。",
    recovery: "通話詳細の「顧客の確認」から手動で選択",
  },
} as const satisfies Record<
  string,
  { category: string; message: string; recovery: string }
>;

export type KmbErrorCode = keyof typeof KMB_ERRORS;

export function getErrorInfo(code: KmbErrorCode) {
  return KMB_ERRORS[code];
}
