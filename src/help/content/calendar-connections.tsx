import { createAnnotator, type HelpShotJson } from "../annotate";
import type { HelpDoc } from "../types";

import overviewJson from "../../../public/help/calendar-connections/01-overview.json";
import cardJson from "../../../public/help/calendar-connections/02-connection-card.json";
import issuesJson from "../../../public/help/calendar-connections/03-sync-issues.json";
import deletedJson from "../../../public/help/calendar-connections/04-deleted-row.json";
import connectedJson from "../../../public/help/calendar-connections/05-connected.json";

/**
 * 「カレンダー — 外部連携」(/admin/calendar/connections) のヘルプ本文。
 * 注釈の座標は撮影時に記録した JSON から組み立てる (手打ちしない)。
 */
const overview = createAnnotator(overviewJson as HelpShotJson);
const card = createAnnotator(cardJson as HelpShotJson);
const issues = createAnnotator(issuesJson as HelpShotJson);
const deleted = createAnnotator(deletedJson as HelpShotJson);
const connected = createAnnotator(connectedJson as HelpShotJson);

const overviewShot = overview.screenshot({
  src: "/help/calendar-connections/01-overview.png",
  alt: "外部連携の画面全体。上に Google と Microsoft のカード、下に同期の問題の表がある。",
  caption: "画面は上下 2 つに分かれます。上が「つなぐ」、下が「うまく行かなかった予定を直す」です。",
  annotations: [
    overview.box("page-header", 1),
    overview.badge("help-button", 2),
    overview.box("calendar-settings-tabs", 3),
    overview.box("connection-cards", 4),
    overview.box("sync-issues-section", 5),
    overview.box("sync-now", 6),
  ],
});

const cardShot = card.screenshot({
  src: "/help/calendar-connections/02-connection-card.png",
  alt: "Google と Microsoft の接続カード。状態の札、アカウント名などの一覧、下にボタンが並ぶ。",
  caption: "接続カード。今つながっているかどうかが、右上の札で分かります。",
  annotations: [
    card.box("connection-card-google", 1),
    card.box("connection-status-google", 2),
    card.box("connection-detail-google", 3),
    card.box("connection-buttons-google", 4),
    card.box("connection-card-microsoft", 5),
  ],
});

const issuesShot = issues.screenshot({
  src: "/help/calendar-connections/03-sync-issues.png",
  alt: "同期の問題の表。ブロック・連携先・状態・エラー・検知時刻・アクションの列が並ぶ。",
  caption: "「同期の問題」の表。1 行が「行き来できなかった予定 1 つ」です。",
  annotations: [
    issues.box("sync-now", 1),
    issues.box("sync-issues-table", 2),
    issues.box("sync-issue-row-deleted_externally", 3),
    issues.box("sync-issue-row-conflict-kmb-e724", 4),
    issues.box("sync-issue-row-conflict-kmb-e723", 5),
    issues.box("sync-issue-row-orphaned", 6),
  ],
});

const deletedShot = deleted.screenshot({
  src: "/help/calendar-connections/04-deleted-row.png",
  alt: "同期の問題の各行にある直し方のボタン。状態ごとに出るボタンが違う。",
  caption: "直し方のボタンは、状態ごとに変わります。出ているボタンから選べば大丈夫です。",
  annotations: [
    deleted.box("sync-issue-status-deleted_externally", 1),
    deleted.box("sync-issue-actions-deleted_externally", 2),
    deleted.box("sync-issue-actions-conflict-kmb-e724", 3),
    deleted.box("sync-issue-actions-orphaned", 4),
  ],
});

const connectedShot = connected.screenshot({
  src: "/help/calendar-connections/05-connected.png",
  alt: "接続が終わった直後の画面。緑の帯に「Google カレンダーに接続しました。」と出ている。",
  caption: "接続が終わると緑の帯が出ます。カードの札も「接続中」に変わります。",
  annotations: [
    connected.box("connected-banner", 1),
    connected.box("connection-status-google", 2),
    connected.box("connection-detail-google", 3),
    connected.box("connection-buttons-google", 4),
  ],
});

export const doc: HelpDoc = {
  slug: "calendar-connections",
  title: "カレンダー — 外部連携 (Google / Microsoft)",
  adminPath: "/admin/calendar/connections",
  summary: [
    "会社で使っている Google カレンダーや Outlook のカレンダーと、この仕組みをつなげます。",
    "つなぐと、作業の予定が外のカレンダーにも自動で入り、スマートフォンでも見られます。",
    "今つながっているか、最後にやり取りしたのはいつかを確かめられます。",
    "行き来できなかった予定を見つけて、その場でボタン 1 つで直せます。",
    "待ちたくないときは「今すぐ同期」で、すぐにやり取りさせられます。",
    "使うのをやめたいときは「切断」でつながりを外せます。",
  ],
  flow: [
    {
      step: "つなぎたい方のカードで「接続する」を押す",
      where: "画面上半分、**Google カレンダー** か **Microsoft カレンダー (Outlook)** のカード",
      result: "Google または Microsoft のログイン画面が開きます。",
    },
    {
      step: "使いたいアカウントを選んで「許可」を押す",
      where: "開いた Google / Microsoft の画面",
      result: "この画面に戻り、緑の帯で「接続しました。」と出ます。",
    },
    {
      step: "カードの札が「接続中」になったか確かめる",
      where: "カード右上の小さな札",
      result: "アカウント名と、この仕組み専用のカレンダー名が表示されます。",
    },
    {
      step: "予定表で作業の予定を入れる",
      where: "左のメニューの **カレンダー**",
      result: "同じ予定が、外のカレンダーにも自動で作られます。",
    },
    {
      step: "週に 1 回、下の「同期の問題」を見る",
      where: "画面下半分の表",
      result: "行き来できなかった予定があれば、ここに並びます。0 件なら何もしなくて大丈夫です。",
    },
    {
      step: "並んでいる行のボタンで直す",
      where: "表のいちばん右の「アクション」の列",
      result: "直した行は表から消えます。",
    },
  ],
  sections: [
    {
      id: "overview",
      heading: "画面全体の並び",
      body: [
        "この画面は上下 2 つに分かれています。",
        "上は **つなぐための場所**、下は **うまく行かなかった予定を直す場所** です。",
        "上の 3 つのタブで、テンプレートや作業種別の画面にも移れます。",
      ],
      screenshot: overviewShot,
      items: [
        {
          number: 1,
          name: "見出しと説明",
          what: "この画面の名前です。左上の「← 予定表へ」で、いつでも予定表に戻れます。",
        },
        {
          number: 2,
          name: "「?」ボタン",
          what: "今見ている画面の使い方 (このページ) を別の窓で開きます。",
        },
        {
          number: 3,
          name: "カレンダー設定のタブ",
          what: "外部連携・テンプレート・作業種別を行き来する切り替えです。",
          affects: "テンプレートを直すと、案件から予定を作るときの初期値が変わります。",
        },
        {
          number: 4,
          name: "接続カード (2 枚)",
          what: "左が Google、右が Microsoft (Outlook) です。つなぐ・やめるはここで行います。",
          affects: "つなぐと、予定表で作った作業の予定が外のカレンダーにも作られます。",
        },
        {
          number: 5,
          name: "同期の問題",
          what: "行き来できなかった予定の一覧です。何も無ければ「同期の問題はありません。」と出ます。",
          affects: "ここで直すと、予定表のその予定の状態も変わることがあります。",
        },
        {
          number: 6,
          name: "「今すぐ同期」ボタン",
          what: "ふだんは自動でやり取りしますが、待たずにすぐ反映したいときに押します。",
          affects: "押すと「取込 ○ / 反映 ○」のような結果が短く表示されます。",
        },
      ],
      relations: [
        {
          label: "カレンダー (作業予定)",
          href: "/admin/calendar",
          why: "ここで作った予定が、外のカレンダーへ送られます。",
        },
        {
          label: "カレンダー — テンプレート",
          href: "/admin/calendar/templates",
          why: "案件から予定を自動で作るときの、作業の組み合わせを決めます。",
        },
        {
          label: "設定",
          href: "/admin/settings",
          why: "接続に使う申し込み情報 (外部連携のタブ) はここで登録します。",
        },
      ],
    },
    {
      id: "cards",
      heading: "接続カードの見方",
      body: [
        "カードは Google 用と Microsoft 用の 2 枚です。両方つないでも構いません。",
        "右上の札が **接続中** なら、今つながっています。",
        "**要再連携** や **エラー** のときは、もう一度「再連携」を押してつなぎ直します。",
      ],
      screenshot: cardShot,
      items: [
        {
          number: 1,
          name: "Google カレンダーのカード",
          what: "Google のアカウントとつなぐための箱です。",
          affects: "つなぐと、予定表の予定が Google 側にも作られます。",
        },
        {
          number: 2,
          name: "状態の札",
          what: "「未接続」「接続中」「要再連携」「エラー」の 4 つのどれかが出ます。",
          affects: "「要再連携」の間は、予定の行き来が止まります。",
        },
        {
          number: 3,
          name: "アカウントなどの一覧",
          what: "つないだアカウント、この仕組み専用のカレンダー名、有効期限、最後に取り込んだ時刻です。",
          affects: "専用のカレンダーは自動で作られます。ふだんの予定とは分かれて入ります。",
        },
        {
          number: 4,
          name: "ボタンの並び",
          what: "「接続する」または「再連携」と、「切断」が出ます。",
          affects: "切断すると、この仕組みと外のカレンダーの結び付きだけが消えます。外の予定は残ります。",
        },
        {
          number: 5,
          name: "Microsoft カレンダーのカード",
          what: "Outlook のアカウント用です。個人向けのアカウントのときの注意書きも出ます。",
          affects: "空き時間の調べ方が簡単な方法に切り替わることがあります。予定の行き来には影響しません。",
        },
      ],
      relations: [
        {
          label: "設定",
          href: "/admin/settings",
          why: "「接続する」が押せないときは、外部連携のタブで申し込み情報を登録します。",
        },
      ],
    },
    {
      id: "sync-issues",
      heading: "「同期の問題」の読み方",
      body: [
        "この表に出るのは、**予定の行き来がうまくいかなかったもの** だけです。",
        "1 行が 1 つの予定です。ふだんは 0 件で、空なのが正常です。",
        "状態の列を見れば、何が起きたのかが分かります。",
      ],
      screenshot: issuesShot,
      items: [
        {
          number: 1,
          name: "「今すぐ同期」ボタン",
          what: "自動の順番を待たずに、その場でやり取りさせます。",
          affects: "押した直後に表の行が減ることがあります。",
        },
        {
          number: 2,
          name: "問題の表",
          what: "予定の名前・連携先・状態・エラー・見つけた時刻・直し方のボタンが並びます。",
        },
        {
          number: 3,
          name: "「外部で削除」の行",
          what: "外のカレンダー側で、その予定が消されたという意味です。",
          affects: "予定表にはまだ残っています。3 つのボタンのどれかで、どうするか決めます。",
        },
        {
          number: 4,
          name: "「競合」で照合が必要な行",
          what: "外へ送ったものの、届いたかどうかを確かめられなかった予定です。",
          affects: "「照合して再開」を押すと、二重にならないように確かめてから続きを行います。",
        },
        {
          number: 5,
          name: "「競合」で送信に失敗した行",
          what: "外へ送ること自体ができなかった予定です。",
          affects: "「再送」を押すと、もう一度送り直します。",
        },
        {
          number: 6,
          name: "「孤立」の行",
          what: "外の予定との結び付きだけが切れてしまった状態です。",
          affects: "「再送」で作り直すか、「リンクを削除」で結び付きを捨てるかを選びます。",
        },
      ],
      relations: [
        {
          label: "カレンダー (作業予定)",
          href: "/admin/calendar",
          why: "「未配置に戻す」を選ぶと、その予定は予定表の未配置の箱へ戻ります。",
        },
      ],
    },
    {
      id: "fix",
      heading: "直し方のボタンの選び方",
      body: [
        "ボタンは状態ごとに変わります。**出ているボタンから選べば間違いありません**。",
        "迷ったときは、まず「今すぐ同期」を押してみてください。自然に直ることがあります。",
        "どのボタンも、外のカレンダーの他の予定を消すことはありません。",
      ],
      screenshot: deletedShot,
      items: [
        {
          number: 1,
          name: "状態の札",
          what: "この行に何が起きたかを短く表します。ボタンの中身はこの札で決まります。",
        },
        {
          number: 2,
          name: "外で消されたときの 3 つのボタン",
          what: "「未配置に戻す」「キャンセルする」「作り直して再送」から選びます。",
          affects: "未配置に戻すと予定表の日時が外れ、キャンセルにするとその作業自体が取り消しになります。",
        },
        {
          number: 3,
          name: "「照合して再開」ボタン",
          what: "外に届いていたかどうかを確かめてから、続きを行います。",
          affects: "届いていれば「反映済み」として扱い、届いていなければ送り直します。二重になりません。",
        },
        {
          number: 4,
          name: "孤立したときの 2 つのボタン",
          what: "「再送」で作り直すか、「リンクを削除」で結び付きだけを捨てます。",
          affects: "リンクを削除しても、予定表の予定は消えません。",
        },
      ],
      relations: [
        {
          label: "やること",
          href: "/admin/tasks",
          why: "予定をキャンセルにしたときは、代わりの段取りをここに残しておくと忘れません。",
        },
      ],
    },
    {
      id: "connected",
      heading: "接続が終わった直後の画面",
      body: [
        "接続が終わると、この画面に自動で戻ってきます。",
        "緑の帯が出ていれば成功です。赤い帯のときは失敗しています。",
        "初回は、外のカレンダーに専用のカレンダーが 1 つ自動で作られます。",
      ],
      screenshot: connectedShot,
      items: [
        {
          number: 1,
          name: "緑の帯",
          what: "「〜に接続しました。」と出ます。画面を開き直すと消えます。",
        },
        {
          number: 2,
          name: "「接続中」の札",
          what: "つながっている印です。ここが変わっていれば接続は成功です。",
        },
        {
          number: 3,
          name: "アカウントと専用カレンダー",
          what: "どのアカウントにつないだかを確かめられます。",
          affects: "違うアカウントだったときは、切断してからやり直します。",
        },
        {
          number: 4,
          name: "「再連携」と「切断」",
          what: "つなぎ直すときと、やめるときのボタンです。",
        },
      ],
      relations: [
        {
          label: "カレンダー (作業予定)",
          href: "/admin/calendar",
          why: "接続できたら、予定表で予定を 1 つ作って外に届くか試すと確実です。",
        },
      ],
    },
  ],
  useCases: [
    {
      persona: "yamagishi",
      title: "現場でもスマートフォンで作業予定を見られるようにする",
      situation: "現場に出ていると、事務所のパソコンを開けない。ふだん使っている Google カレンダーで予定を見たい。",
      steps: [
        {
          action: "左のメニューの「カレンダー」を開き、右上の設定から「外部連携」に入る",
          where: "左のメニュー → カレンダー → 外部連携のタブ",
          result: "Google と Microsoft のカードが並んだ画面が開きます。",
          screenshot: overviewShot,
        },
        {
          action: "Google カレンダーのカードで「接続する」を押す",
          where: "左のカードの下のボタン",
          result: "Google のログイン画面が開きます。",
        },
        {
          action: "会社のアカウントを選んで「許可」を押す",
          where: "開いた Google の画面",
          result: "この画面に戻り、緑の帯で「Google カレンダーに接続しました。」と出ます。",
          screenshot: connectedShot,
        },
        {
          action: "予定表に戻り、来週の本塗装の予定を入れる",
          where: "左のメニューの「カレンダー」",
          result: "数分のうちに、スマートフォンの Google カレンダーにも同じ予定が出ます。",
        },
      ],
      outcome: "現場から、その日の作業予定をスマートフォンで確認できるようになります。",
    },
    {
      persona: "sato",
      title: "外のカレンダーで消してしまった予定を直す",
      situation: "スマートフォンの Google カレンダーで、間違えて「本塗装」の予定を消してしまった。",
      steps: [
        {
          action: "外部連携の画面を開き、下の「同期の問題」を見る",
          where: "画面下半分の表",
          result: "「本塗装 / Google / 外部で削除」の行が並んでいます。",
          screenshot: issuesShot,
        },
        {
          action: "その行の「作り直して再送」を押す",
          where: "表のいちばん右の列",
          result: "「再作成を予約しました。」と短く出ます。",
          screenshot: deletedShot,
        },
        {
          action: "「今すぐ同期」を押して待つ",
          where: "表の上のボタン",
          result: "外のカレンダーに同じ予定が作り直され、表からその行が消えます。",
        },
      ],
      outcome: "消してしまった予定が元どおりになり、職人にも同じ予定が見えます。",
    },
    {
      persona: "yamagishi",
      title: "予定が外に出てこないので、つなぎ直す",
      situation: "何日か前から、新しく入れた予定が Google カレンダーに出てこない。",
      steps: [
        {
          action: "外部連携の画面で、カードの札を確かめる",
          where: "画面上半分の Google のカード",
          result: "札が「要再連携」になっていて、つながりが切れていると分かります。",
          screenshot: cardShot,
        },
        {
          action: "「再連携」を押して、同じアカウントで許可する",
          where: "カード下のボタン",
          result: "札が「接続中」に戻り、緑の帯が出ます。",
        },
        {
          action: "「今すぐ同期」を押す",
          where: "画面下半分の表の上",
          result: "たまっていた予定がまとめて送られ、外のカレンダーに出ます。",
        },
      ],
      outcome: "止まっていた予定の行き来が元に戻り、抜けていた予定も追いつきます。",
    },
  ],
  faqs: [
    {
      q: "「接続する」のボタンが押せません。",
      a: "接続に使う申し込み情報がまだ登録されていない状態です。カードの下に「認証情報が未設定です」と出ていたら、設定の「外部連携」のタブで登録してください。登録すると、このボタンが押せるようになります。",
    },
    {
      q: "接続したのに、外のカレンダーに予定が見つかりません。",
      a: "予定はふだんのカレンダーではなく、この仕組み専用のカレンダーに入ります。カードの「アプリ専用カレンダー」に書かれている名前のカレンダーを、表示する設定にしてください。",
    },
    {
      q: "予定を作ったのに、外に送られません。",
      a: "まずカードの札を見てください。「要再連携」や「エラー」なら、つなぎ直しが必要です。「接続中」なら「今すぐ同期」を押してください。それでも送られないときは、下の「同期の問題」にその予定が出ていないか確かめます。",
    },
    {
      q: "同じ予定が外のカレンダーに二重に出てしまいました。",
      a: "切断してからもう一度つなぎ直すと、古い予定が残ったまま新しい予定が作られることがあります。Microsoft の場合に起こりやすい現象です。外のカレンダーで、古い方を手で消してください。この仕組み側の予定は 1 つのままなので、消しても問題ありません。",
    },
    {
      q: "外のカレンダーで予定を間違えて消しました。戻せますか。",
      a: "戻せます。「同期の問題」にその予定が「外部で削除」として出るので、「作り直して再送」を押してください。外のカレンダーに同じ予定が作り直されます。",
    },
    {
      q: "「切断」を押すと、予定も消えますか。",
      a: "消えません。消えるのは、この仕組みと外のカレンダーの結び付きだけです。予定表の予定も、外のカレンダーにすでに入っている予定も、そのまま残ります。",
    },
    {
      q: "エラーの欄に KMB-E723 と出ています。",
      a: "外のカレンダーへ送ることができなかった、という意味です。その行の「再送」を押してください。何度やっても直らないときは、いったん「再連携」でつなぎ直します。",
    },
    {
      q: "エラーの欄に KMB-E724 と出ています。",
      a: "送った結果を確かめられなかった、という意味です。その行の「照合して再開」を押してください。二重にならないように確かめてから続きを行います。",
    },
    {
      q: "「今すぐ同期」を押したら「同期が進行中です」と出ました。",
      a: "すでにやり取りの最中です。少し待ってからもう一度押してください。二重に動くことはないので、そのまま待っても構いません。",
    },
    {
      q: "「孤立」とはどういう状態ですか。",
      a: "外の予定との結び付きが切れてしまった状態です。「再送」を押すと作り直します。その予定がもう不要なら「リンクを削除」を選びます。どちらを選んでも予定表の予定は消えません。",
    },
    {
      q: "Google と Microsoft の両方をつないでも大丈夫ですか。",
      a: "大丈夫です。両方につなぐと、同じ予定が両方のカレンダーに入ります。片方だけ使いたいときは、使わない方を「切断」してください。",
    },
    {
      q: "他の人が同じ画面で同時に直しても平気ですか。",
      a: "平気です。すでに直された行のボタンを押すと「この状態では実行できません」と出るだけで、二重に直ることはありません。画面を再読み込みすると最新の一覧になります。",
    },
    {
      q: "同期の問題が 0 件です。何かしなくてよいですか。",
      a: "何もしなくて大丈夫です。0 件は「すべて行き来できている」という意味です。週に 1 回のぞいて、0 件のままなら安心です。",
    },
  ],
  related: [
    { label: "カレンダー (作業予定)", href: "/help/calendar" },
    { label: "カレンダー — テンプレート", href: "/help/calendar-templates" },
    { label: "カレンダー — 作業種別", href: "/help/calendar-types" },
    { label: "設定", href: "/help/settings" },
  ],
  glossary: [
    {
      term: "同期",
      meaning: "この仕組みのカレンダーと、外のカレンダーの内容を同じ状態にそろえることです。",
    },
    {
      term: "アプリ専用カレンダー",
      meaning: "この仕組みが作る予定だけを入れる、外のカレンダーの中の専用の入れ物です。",
    },
    {
      term: "再連携",
      meaning: "つながりが切れたときに、もう一度アカウントを選んでつなぎ直すことです。",
    },
    {
      term: "孤立",
      meaning: "外の予定との結び付きだけが切れて、どの予定と対応するか分からなくなった状態です。",
    },
  ],
};
