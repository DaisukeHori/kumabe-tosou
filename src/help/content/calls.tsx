import { createAnnotator, type HelpShotJson } from "../annotate";
import type { HelpDoc } from "../types";

import listJson from "../../../public/help/calls/01-list.json";
import detailJson from "../../../public/help/calls/02-detail.json";
import summaryJson from "../../../public/help/calls/03-summary.json";
import transcriptJson from "../../../public/help/calls/04-transcript.json";
import searchJson from "../../../public/help/calls/05-customer-link.json";
import failedJson from "../../../public/help/calls/06-failed.json";

/**
 * 「通話 (着信・留守電・文字起こし)」(/admin/calls) のヘルプ本文。
 * 注釈の座標は撮影時に記録した JSON から組み立てる (手打ちしない)。
 */
const list = createAnnotator(listJson as HelpShotJson);
const detail = createAnnotator(detailJson as HelpShotJson);
const summary = createAnnotator(summaryJson as HelpShotJson);
const transcript = createAnnotator(transcriptJson as HelpShotJson);
const search = createAnnotator(searchJson as HelpShotJson);
const failed = createAnnotator(failedJson as HelpShotJson);

const listShot = list.screenshot({
  src: "/help/calls/01-list.png",
  alt: "通話の一覧。日時・相手・種別・通話時間・処理状態・要約・要確認の列が並んでいる。",
  caption: "かかってきた電話が、新しい順に上から並びます。",
  annotations: [
    list.box("page-header", 1),
    list.badge("help-button", 2),
    list.box("calls-filters", 3),
    list.box("calls-table", 4),
    list.box("calls-row-1", 5),
    list.box("calls-handling-1", 6),
    list.box("calls-job-status-1", 7),
    list.box("calls-summary-1", 8),
    list.box("calls-review-badge", 9),
  ],
});

const detailShot = detail.screenshot({
  src: "/help/calls/02-detail.png",
  alt: "1 本の電話の詳細。お客様の紐づけ・録音・議事録・起票された用事・処理状態・メモが縦に並ぶ。",
  caption: "行を押すと、その電話 1 本について分かることがすべて出ます。",
  annotations: [
    detail.box("page-header", 1),
    detail.badge("help-button", 2),
    detail.box("call-customer-link", 3),
    detail.box("call-cost", 4),
    detail.box("call-recordings", 5),
    detail.box("call-minutes", 6),
    detail.box("call-tasks", 7),
    detail.box("call-jobs", 8),
    detail.box("call-memo", 9),
  ],
});

const summaryShot = summary.screenshot({
  src: "/help/calls/03-summary.png",
  alt: "議事録の「要約」タブ。用件のまとめ、見積依頼などの札、箇条書きが出ている。",
  caption: "「要約」には、留守電の内容を短くまとめたものが出ます。",
  annotations: [
    summary.box("call-tab-summary", 1),
    summary.box("call-tab-full", 2),
    summary.box("call-summary-body", 3),
    summary.box("call-tasks", 4),
  ],
});

const transcriptShot = transcript.screenshot({
  src: "/help/calls/04-transcript.png",
  alt: "議事録の「全文」タブ。相手が話した言葉と、こちらの自動音声がそのまま並んでいる。",
  caption: "「全文」には、話した言葉がそのまま文字で出ます。",
  annotations: [
    transcript.box("call-tab-summary", 1),
    transcript.box("call-tab-full", 2),
    transcript.box("call-transcript-body", 3),
  ],
});

const searchShot = search.screenshot({
  src: "/help/calls/05-customer-link.png",
  alt: "「顧客を検索」の小窓。名前を打ち込んで、候補のお客様が 2 件出ている。",
  caption: "電話とお客様を手で結び付けるときの小窓です。",
  annotations: [
    search.box("call-search-dialog", 1),
    search.box("call-search-input", 2),
    search.box("call-search-results", 3),
  ],
});

const failedShot = failed.screenshot({
  src: "/help/calls/06-failed.png",
  alt: "処理に失敗した電話の画面。処理状態が赤い「失敗」になり、右に再実行のボタンが出ている。",
  caption: "文字起こしに失敗した電話。赤い「失敗」と「再実行」が出ます。",
  annotations: [
    failed.box("call-customer-link", 1),
    failed.box("call-link-search", 2),
    failed.box("call-link-create", 3),
    failed.box("call-jobs", 4),
    failed.box("call-job-retry", 5),
  ],
});

export const doc: HelpDoc = {
  slug: "calls",
  title: "通話 (着信・留守電・文字起こし)",
  adminPath: "/admin/calls",
  summary: [
    "かかってきた電話を、新しい順に一覧で確かめられます。",
    "留守番電話の録音をその場で聞くことができます。",
    "録音の内容が文字になり、短いまとめも自動で作られます。",
    "電話番号からお客様を自動で見つけて、結び付けます。",
    "「折り返しの電話をする」などの用事が自動で作られます。",
    "うまくいかなかった電話は、その場でやり直しを頼めます。",
  ],
  flow: [
    {
      step: "「通話」を開く",
      where: "左のメニューの ② 受付 の中の **通話**",
      result: "かかってきた電話が、新しい順に並びます。",
    },
    {
      step: "気になる行を探す",
      where: "見出しのすぐ下のボタンの列",
      result: "「留守電」「要確認のみ」などで、見たい電話だけに絞れます。",
    },
    {
      step: "行を押して中を見る",
      where: "一覧の行 (↑↓ で動かして Enter でも開けます)",
      result: "録音・文字・まとめ・お客様の名前が 1 つの画面に出ます。",
    },
    {
      step: "録音を聞く",
      where: "詳細の **録音** の「再生」",
      result: "留守番電話の声がその場で流れます。",
    },
    {
      step: "まとめを読んで、やることを確かめる",
      where: "詳細の **議事録・全文** と、その下の起票タスクの行",
      result: "用件のまとめと、自動で作られた用事の数が分かります。",
    },
    {
      step: "お客様と結び付ける",
      where: "詳細のいちばん上の **顧客紐づけ**",
      result: "誰からの電話かが決まり、お客様の画面にも記録が残ります。",
    },
  ],
  sections: [
    {
      id: "list",
      heading: "一覧の見方",
      body: [
        "この画面には、お店にかかってきた電話が自動で並びます。",
        "自分で新しく足すことはありません。読んで対応する画面です。",
        "**相手** の欄には、お客様として登録済みなら名前が出ます。",
        "登録がまだのときは、電話番号がそのまま出ます。",
        "番号を隠してかけてきた電話は「番号非通知」と出ます。",
      ],
      screenshot: listShot,
      items: [
        {
          number: 1,
          name: "見出しと使い方の案内",
          what: "画面の名前と、キーボードでの動かし方が書いてあります。",
          affects: "赤い「処理の滞留」の札が出たときは、止まっている電話があります。",
        },
        {
          number: 2,
          name: "「?」のボタン",
          what: "この説明のページを開くボタンです。どの画面にもあります。",
        },
        {
          number: 3,
          name: "絞り込みのボタン",
          what: "「留守電」「不在着信」などで、見たい電話だけを残せます。",
          affects: "「要確認のみ」「処理失敗のみ」は、手当てが要る電話だけを集めます。",
        },
        {
          number: 4,
          name: "一覧の表",
          what: "日時・相手・種別・通話時間・処理状態・要約・要確認の順に並びます。",
        },
        {
          number: 5,
          name: "1 本ぶんの行",
          what: "押すと、その電話の詳しい画面へ移ります。",
          affects: "↑↓ で行を選び、Enter でも開けます。Esc で選び直せます。",
        },
        {
          number: 6,
          name: "種別の札",
          what: "「転送」は電話に出た、「留守電」は録音を残してもらった、という意味です。",
          affects: "「時間外留守電」は営業時間の外にかかってきた電話です。",
        },
        {
          number: 7,
          name: "処理状態の札",
          what: "録音を文字にする作業が、今どこまで進んだかを表します。",
          affects: "「完了」なら要約まで終わり、「失敗」なら途中で止まっています。",
        },
        {
          number: 8,
          name: "要約の欄",
          what: "用件のまとめの先頭だけが出ます。全部は詳しい画面で読めます。",
        },
        {
          number: 9,
          name: "「要確認」の札",
          what: "同じ番号のお客様が何人もいて、どなたか決められなかった印です。",
          affects: "詳しい画面を開いて、手で正しいお客様を選びます。",
        },
      ],
      relations: [
        {
          label: "やること",
          href: "/admin/tasks",
          why: "留守電から自動で作られた用事は、やることの一覧にも「電話AI」の印で並びます。",
        },
        {
          label: "今日の仕事",
          href: "/admin",
          why: "止まっている電話があると、トップページにも件数が出ます。",
        },
      ],
    },
    {
      id: "detail",
      heading: "1 本の電話の画面",
      body: [
        "一覧の行を押すと、その電話についての情報が縦に並びます。",
        "上から順に、お客様・録音・文字とまとめ・用事・処理の様子・メモです。",
        "Esc を押すと一覧へ戻ります。",
      ],
      screenshot: detailShot,
      items: [
        {
          number: 1,
          name: "見出し",
          what: "相手の電話番号と、キーボードでの操作の案内が出ます。",
        },
        {
          number: 2,
          name: "「?」のボタン",
          what: "この説明のページを開きます。",
        },
        {
          number: 3,
          name: "お客様との結び付き",
          what: "誰からの電話かが書いてあります。名前が分からないときは「(名称不明)」と出ます。",
          affects: "ここで選んだお客様の画面に、この電話の記録が残ります。",
        },
        {
          number: 4,
          name: "「コスト内訳 (概算)」",
          what: "この電話 1 本にかかったおよその費用を出します。",
          affects: "細かい合計は AI 利用料金の画面で見られます。",
        },
        {
          number: 5,
          name: "録音",
          what: "「再生」を押すと、留守番電話の声がその場で流れます。",
          affects: "Space キーでも再生と一時停止ができます。",
        },
        {
          number: 6,
          name: "議事録・全文",
          what: "「要約」と「全文」の 2 つの見方を切り替えられます。",
        },
        {
          number: 7,
          name: "起票タスク",
          what: "この電話から自動で作られた用事の数と、そこへの入口です。",
          affects: "「やること一覧へ」を押すと、その用事を見に行けます。",
        },
        {
          number: 8,
          name: "処理状態",
          what: "録音を文字にする作業の記録です。失敗したときは理由も出ます。",
        },
        {
          number: 9,
          name: "メモ",
          what: "折り返した結果など、自分の言葉で書き足せる欄です。",
          affects: "書いたら「保存」を押します。Cmd+S でも保存できます。",
        },
      ],
      relations: [
        {
          label: "顧客",
          href: "/admin/customers",
          why: "結び付けたお客様の画面に、この電話のやり取りが記録として残ります。",
        },
        {
          label: "AI 利用料金",
          href: "/admin/costs",
          why: "文字起こしとまとめの作成には料金がかかり、その日の合計に足されます。",
        },
      ],
    },
    {
      id: "minutes",
      heading: "まとめと全文",
      body: [
        "留守番電話の録音は、まず文字に直されます。",
        "そのあと、用件を短くまとめたものが自動で作られます。",
        "まとめは機械が作った下書きです。大事な数字は録音でも確かめてください。",
      ],
      screenshot: summaryShot,
      items: [
        {
          number: 1,
          name: "「要約」のタブ",
          what: "用件のまとめを見るときに押します。はじめはこちらが開いています。",
        },
        {
          number: 2,
          name: "「全文」のタブ",
          what: "話した言葉をそのまま読みたいときに押します。",
        },
        {
          number: 3,
          name: "まとめの本文",
          what: "何の用事かの文と、「見積依頼」などの札、箇条書きが出ます。",
          affects: "「折り返し要」の札があれば、こちらから電話をかけ直します。",
        },
        {
          number: 4,
          name: "起票タスク",
          what: "まとめから自動で作られた用事の数です。押すと一覧へ移れます。",
        },
      ],
    },
    {
      id: "transcript",
      heading: "話した言葉をそのまま読む",
      body: [
        "「全文」を押すと、聞き取った言葉がそのまま並びます。",
        "「相手」はかけてきた人、「こちら」はお店の自動音声です。",
        "聞き取りは完全ではありません。数字や名前は録音で確かめてください。",
      ],
      screenshot: transcriptShot,
      items: [
        {
          number: 1,
          name: "「要約」のタブ",
          what: "短いまとめに戻すときに押します。",
        },
        {
          number: 2,
          name: "「全文」のタブ",
          what: "今開いているタブです。下線が付いているほうが選ばれています。",
        },
        {
          number: 3,
          name: "全文の本文",
          what: "話した順に、そのままの言葉が並びます。",
          affects: "まとめが無い電話でも、こちらだけは読めることがあります。",
        },
      ],
    },
    {
      id: "link",
      heading: "お客様と結び付ける",
      body: [
        "登録済みの電話番号からの着信は、自動でそのお客様に結び付きます。",
        "同じ番号の方が何人もいるときは「要確認」になり、手で選びます。",
        "「顧客を検索して紐づける」を押すと、この小窓が開きます。",
      ],
      screenshot: searchShot,
      items: [
        {
          number: 1,
          name: "検索の小窓",
          what: "お客様を探して選ぶための小窓です。Esc で閉じられます。",
        },
        {
          number: 2,
          name: "検索の欄",
          what: "名前や電話番号の一部を打つと、候補が下に出ます。",
          affects: "はじめは相手の電話番号が入った状態で開きます。",
        },
        {
          number: 3,
          name: "候補の並び",
          what: "↑↓ で選び、Enter で結び付けます。押しても選べます。",
          affects: "見つからないときは「新しい顧客として作る」で登録できます。",
        },
      ],
      relations: [
        {
          label: "顧客",
          href: "/admin/customers",
          why: "ここで新しく作ったお客様は、顧客の一覧にもすぐ並びます。",
        },
        {
          label: "問い合わせ",
          href: "/admin/inquiries",
          why: "ホームページからの相談も、同じお客様にまとめて記録できます。",
        },
      ],
    },
    {
      id: "failed",
      heading: "うまくいかなかったとき",
      body: [
        "録音の取り込みや文字起こしは、まれに途中で止まります。",
        "そのときは処理状態が赤い「失敗」になり、理由が出ます。",
        "「再実行」を押すと、止まったところからやり直します。",
      ],
      screenshot: failedShot,
      items: [
        {
          number: 1,
          name: "お客様との結び付き",
          what: "まだ誰からの電話か決まっていないときの見え方です。",
        },
        {
          number: 2,
          name: "「顧客を検索して紐づける」",
          what: "登録済みのお客様から選んで結び付けます。",
        },
        {
          number: 3,
          name: "「新しい顧客として作る」",
          what: "はじめてのお客様のとき、その場で登録して結び付けます。",
        },
        {
          number: 4,
          name: "処理状態",
          what: "赤い「失敗」と、止まった時刻・理由が出ます。",
        },
        {
          number: 5,
          name: "「再実行」",
          what: "押すともう一度やり直します。一覧では r キーでも同じことができます。",
          affects: "何度やっても失敗するときは、録音そのものが取れていない場合があります。",
        },
      ],
    },
  ],
  useCases: [
    {
      persona: "yamagishi",
      title: "夜のうちに入った留守電に、朝いちばんで折り返す",
      situation: "昨夜の営業時間の外に電話があり、留守番電話が残っている。",
      steps: [
        {
          action: "通話の一覧を開く",
          where: "左のメニューの ② 受付 の中の **通話**",
          result: "いちばん上に、昨夜の「時間外留守電」の行が並んでいます。",
          screenshot: listShot,
        },
        {
          action: "その行を押す",
          where: "一覧の 1 行目",
          result: "録音・まとめ・自動で作られた用事が 1 つの画面に出ます。",
        },
        {
          action: "まとめを読む",
          where: "詳細の **議事録・全文** の「要約」",
          result: "「色を変えたい」「見積書がほしい」など、用件が箇条書きで分かります。",
          screenshot: summaryShot,
        },
        {
          action: "数字だけ録音で確かめる",
          where: "詳細の **録音** の「再生」",
          result: "個数や納期など、大事なところを自分の耳でも確認できます。",
        },
        {
          action: "折り返したらメモを書いて保存する",
          where: "詳細のいちばん下の **メモ**",
          result: "「夕方に折り返し済み」と残せて、次に見た人にも伝わります。",
        },
      ],
      outcome: "留守電を聞き直さなくても用件が分かり、その日のうちに折り返せます。",
    },
    {
      persona: "sato",
      title: "「要確認」の電話を、正しいお客様に結び付ける",
      situation: "同じ番号のお客様が二重に登録されていて、どなたか決まっていない。",
      steps: [
        {
          action: "「要確認のみ」で絞り込む",
          where: "一覧の見出しのすぐ下のボタンの列",
          result: "手当ての要る電話だけが残ります。",
        },
        {
          action: "行を押して詳細を開く",
          where: "残った行",
          result: "いちばん上に「顧客を検索して紐づける」のボタンが出ています。",
        },
        {
          action: "お客様を探して選ぶ",
          where: "開いた小窓の検索の欄",
          result: "名前を打つと候補が出るので、正しい方を Enter で選びます。",
          screenshot: searchShot,
        },
        {
          action: "二重の登録を片づける",
          where: "顧客の画面の統合の機能",
          result: "同じ方が 2 人分に分かれている状態を、1 人にまとめられます。",
        },
      ],
      outcome: "誰からの電話かが決まり、そのお客様の画面にも記録が残ります。",
    },
    {
      persona: "sato",
      title: "文字起こしに失敗した電話をやり直す",
      situation: "一覧に赤い「失敗」の札が出ていて、まとめが作られていない。",
      steps: [
        {
          action: "「処理失敗のみ」で絞り込む",
          where: "一覧の見出しのすぐ下のボタンの列",
          result: "止まっている電話だけが残ります。",
        },
        {
          action: "行を押して理由を読む",
          where: "詳細の **処理状態**",
          result: "いつ、どの段階で止まったかが赤い字で出ています。",
          screenshot: failedShot,
        },
        {
          action: "「再実行」を押す",
          where: "処理状態の右はし",
          result: "もう一度やり直され、うまくいけば札が「完了」に変わります。",
        },
        {
          action: "それでも直らないときは録音を聞く",
          where: "詳細の **録音** の「再生」",
          result: "無音や短すぎる録音なら、文字にできないのが理由と分かります。",
        },
      ],
      outcome: "止まっていた電話が処理し直され、まとめと用事が作られます。",
    },
  ],
  faqs: [
    {
      q: "電話を自分で新しく足すことはできますか。",
      a: "できません。かかってきた電話が自動で並ぶ画面です。自分の言葉で残したいことは、詳細のいちばん下のメモに書きます。",
    },
    {
      q: "メモが保存できません。",
      a: "他の人が先に同じ電話のメモを保存したときは、上書きを止めて知らせます。画面を読み込み直してから、もう一度書いて保存してください。",
    },
    {
      q: "探している電話が見つかりません。",
      a: "絞り込みのボタンが押されたままになっていないか確かめてください。すべてを解除すると全部が並びます。古い電話は下の「さらに読み込む」で出せます。",
    },
    {
      q: "折り返しても相手に電話がつながりません。",
      a: "この画面から電話をかけることはできません。相手の番号を見て、いつもの電話機からかけ直してください。",
    },
    {
      q: "同じお客様の記録が二重になってしまいました。",
      a: "顧客の画面で 2 件を 1 件にまとめられます。まとめたあとは、この画面の記録も残ったほうのお客様に付きます。",
    },
    {
      q: "間違えて別のお客様に結び付けてしまいました。",
      a: "詳細の顧客紐づけにある「付け替え」で選び直せます。誰にも結び付けない状態に戻したいときは「解除」を押します。",
    },
    {
      q: "電話の記録を消すことはできますか。",
      a: "消す機能はありません。まちがえて結び付けたときは付け替えか解除で直します。記録そのものは残ります。",
    },
    {
      q: "処理状態が「文字起こし中」のまま進みません。",
      a: "録音が長いと数分かかります。しばらくたっても変わらないときは、画面を読み込み直してください。それでも変わらなければ「再実行」を押します。",
    },
    {
      q: "処理状態に「失敗」と赤く出ています。",
      a: "録音の取り込みか文字起こしが途中で止まっています。右の「再実行」を押してください。一覧では r キーでも同じことができます。",
    },
    {
      q: "画面のうえに「処理の滞留 1 件」と出ています。",
      a: "止まったままの電話がその数だけあるという意味です。「処理失敗のみ」で絞り込んで、順に再実行してください。",
    },
    {
      q: "「電話連携は未設定です」という帯が出ています。",
      a: "電話を受けるための登録がまだ終わっていない、という意味です。設定の画面で手順を進めると消えます。",
    },
    {
      q: "要約が出ない電話があります。",
      a: "録音が無い電話 (不在着信や転送) では作られません。録音があるのに出ないときは、処理状態を見て「再実行」を押してください。",
    },
    {
      q: "まとめの内容が実際と少し違います。",
      a: "まとめは機械が作った下書きです。数量・金額・日付などは録音か全文で必ず確かめてください。直したいことはメモに書き足せます。",
    },
    {
      q: "「(名称不明)」と出ているのはなぜですか。",
      a: "電話は結び付いているのに、お客様の名前を読み出せなかったときの表示です。付け替えで選び直すと名前が出るようになります。",
    },
    {
      q: "この画面を見るとお金がかかりますか。",
      a: "見るだけならかかりません。文字起こしとまとめの作成に料金がかかり、AI 利用料金の画面でその日の合計として確かめられます。",
    },
  ],
  related: [
    { label: "やること", href: "/admin/tasks" },
    { label: "顧客", href: "/admin/customers" },
    { label: "問い合わせ", href: "/admin/inquiries" },
    { label: "今日の仕事", href: "/admin" },
    { label: "AI 利用料金", href: "/admin/costs" },
    { label: "設定", href: "/admin/settings" },
    { label: "やることの説明", href: "/help/tasks" },
    { label: "顧客の説明", href: "/help/customers" },
  ],
  glossary: [
    { term: "着信", meaning: "お店にかかってきた電話のことです。" },
    { term: "留守電", meaning: "電話に出られないときに、用件を録音してもらう仕組みです。" },
    { term: "時間外", meaning: "決めておいた営業時間の外、という意味です。" },
    { term: "文字起こし", meaning: "録音された声を、読める文字に直すことです。" },
    { term: "要約", meaning: "長い話を短くまとめたものです。ここでは機械が作ります。" },
    { term: "紐づけ", meaning: "この電話が誰からのものかを決めて、結び付けることです。" },
  ],
};
