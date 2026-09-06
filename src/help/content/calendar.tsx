import { createAnnotator, type HelpShotJson } from "../annotate";
import type { HelpDoc } from "../types";

import weekJson from "../../../public/help/calendar/01-week.json";
import trayJson from "../../../public/help/calendar/02-tray.json";
import createJson from "../../../public/help/calendar/03-create.json";
import detailJson from "../../../public/help/calendar/04-detail.json";
import actualJson from "../../../public/help/calendar/05-actual.json";
import autoJson from "../../../public/help/calendar/06-auto-place.json";
import monthJson from "../../../public/help/calendar/07-month.json";

/**
 * カレンダー (作業予定) /admin/calendar のヘルプ本文。
 * canonical: docs/design/admin-help/README.md §3・§4。
 * 注釈の座標は撮影時に記録した JSON から組み立てる (手打ちしない)。
 */
const week = createAnnotator(weekJson as HelpShotJson);
const tray = createAnnotator(trayJson as HelpShotJson);
const create = createAnnotator(createJson as HelpShotJson);
const detail = createAnnotator(detailJson as HelpShotJson);
const actual = createAnnotator(actualJson as HelpShotJson);
const auto = createAnnotator(autoJson as HelpShotJson);
const month = createAnnotator(monthJson as HelpShotJson);

const weekShot = week.screenshot({
  src: "/help/calendar/01-week.png",
  alt: "カレンダーの週の表。左に 7 日分の時間割、右に日程が決まっていない仕事の置き場が並んでいる。",
  caption: "週の表。左が 7 日分の時間割、右が「まだ日を決めていない仕事」の置き場です。",
  annotations: [
    week.box("page-header", 1),
    week.badge("help-button", 2),
    week.box("capacity-badge", 3),
    week.box("create-block", 4),
    week.box("view-nav", 5),
    week.box("view-tabs", 6),
    week.box("week-grid", 7),
    week.box("backlog-tray", 8),
  ],
});

const trayShot = tray.screenshot({
  src: "/help/calendar/02-tray.png",
  alt: "画面右側の「未配置」の置き場。仕事の札が 6 枚並び、上に「自動で並べる」ボタンがある。",
  caption: "「未配置」は、やることは決まったが日時がまだの仕事の置き場です。",
  annotations: [
    tray.box("backlog-tray", 1),
    tray.box("auto-place", 2),
    tray.box("capacity-badge", 3),
    tray.box("create-block", 4),
  ],
});

const createShot = create.screenshot({
  src: "/help/calendar/03-create.png",
  alt: "「作業ブロックを作る」の入力画面。案件・種別・タイトル・予定時間・メモの欄が並んでいる。",
  caption: "「ブロックを作る」を押すと出る入力画面です。",
  annotations: [
    create.box("create-deal", 1),
    create.box("create-type", 2),
    create.box("create-hours", 3),
    create.box("create-place-now", 4),
    create.box("create-submit", 5),
  ],
});

const detailShot = detail.screenshot({
  src: "/help/calendar/04-detail.png",
  alt: "予定の札を押したときに出る詳細画面。日時の変更欄、案件・種別・時間の編集欄、着手やキャンセルのボタンがある。",
  caption: "札を 1 回押すと、その仕事の詳細が開きます。",
  annotations: [
    detail.box("detail-place", 1),
    detail.box("detail-form", 2),
    detail.box("detail-status", 3),
    detail.badge("detail-dialog", 4),
  ],
});

const actualShot = actual.screenshot({
  src: "/help/calendar/05-actual.png",
  alt: "同じ詳細画面を下までスクロールしたところ。「実績を入れる」の欄に時間と日付と保存ボタンがある。",
  caption: "詳細を下までスクロールすると、かかった時間を書く欄が出ます。",
  annotations: [
    actual.box("detail-actual", 1),
    actual.box("detail-status", 2),
    actual.badge("detail-dialog", 3),
  ],
});

const autoShot = auto.screenshot({
  src: "/help/calendar/06-auto-place.png",
  alt: "「自動で並べる」を押した直後。点線の枠で置き場所の下書きが表示され、上に「確定」「やめる」のバーが出ている。",
  caption: "「自動で並べる」を押すと、点線で下書きが出ます。まだ確定していません。",
  annotations: [
    auto.box("proposal-bar", 1),
    auto.box("week-grid", 2),
    auto.box("backlog-tray", 3),
    auto.box("capacity-badge", 4),
  ],
});

const monthShot = month.screenshot({
  src: "/help/calendar/07-month.png",
  alt: "月の表。1 か月分のマス目が並び、予定のある日に色の丸と件数が出ている。",
  caption: "月の表。忙しい日と空いている日をひと目で見比べられます。",
  annotations: [
    month.box("month-grid", 1),
    month.box("view-tabs", 2),
    month.box("view-nav", 3),
    month.box("capacity-badge", 4),
  ],
});

export const doc: HelpDoc = {
  slug: "calendar",
  title: "カレンダー (作業予定)",
  adminPath: "/admin/calendar",
  summary: [
    "研磨・下地・塗装・乾燥・検品といった作業の予定を、1 週間ぶんの時間割で確認できます。",
    "日がまだ決まっていない仕事を右側にためておき、あとからドラッグで日時に置けます。",
    "「自動で並べる」を押すと、空いている時間に順番に置く下書きを作れます。",
    "今週あと何時間ぶん入れられるかが、いつも画面の左上に出ます。",
    "作業が終わったら、実際にかかった時間を記録して予定とのずれを見られます。",
  ],
  flow: [
    {
      step: "カレンダーを開く",
      where: "左のメニューの **カレンダー**",
      result: "今日を含む 1 週間の時間割が出ます。右には日程が決まっていない仕事が並びます。",
    },
    {
      step: "やる仕事を用意する",
      where: "左上の **ブロックを作る**、または案件の画面の「作業ブロックを用意」",
      result: "1 つの作業が「札」になります。日時を入れなければ右の置き場に入ります。",
    },
    {
      step: "札を日時に置く",
      where: "右の置き場から時間割へドラッグ、または **自動で並べる**",
      result: "予定が決まり、札が時間割の上に色つきで表示されます。",
    },
    {
      step: "予定を直す",
      where: "時間割の札をドラッグ、または札を押して開く詳細の **移動する**",
      result: "30 分きざみで時間が変わります。下の端を引っぱると長さも変わります。",
    },
    {
      step: "作業を始める・終える",
      where: "札を押して開く詳細の **着手**",
      result: "その仕事が「着手中」になり、案件の進みぐあいの目安になります。",
    },
    {
      step: "かかった時間を記録する",
      where: "詳細の下のほうにある **実績を保存**",
      result: "予定と実際の差が表示され、次の見積りの参考になります。",
    },
  ],
  sections: [
    {
      id: "week",
      heading: "週の表の見方",
      body: [
        "はじめに開くのは **週の表** です。横が 7 日、縦が時刻です。",
        "色のついた四角が 1 つの作業です。色は作業の種類ごとに決まっています。",
        "ななめのしま模様になっている札は「乾燥」のように、人が張りつかない待ち時間です。",
        "表は 0 時から 24 時まであります。上下にスクロールすると早朝や夜も見られます。",
      ],
      screenshot: weekShot,
      items: [
        {
          number: 1,
          name: "見出しとキーボードの案内",
          what: "画面の名前と、キーだけで操作するときの早見表です。",
          affects: "T で今日、W で週、M で月に切り替わります。",
        },
        {
          number: 2,
          name: "「?」ボタン",
          what: "今ご覧になっているこの説明を開くボタンです。",
        },
        {
          number: 3,
          name: "今週あと〇時間",
          what: "今週に入れられる残り時間です。1 週間の働ける時間から、今週入っている作業の予定時間を引いた数です。",
          affects: "働ける時間は設定で決めます。待ち時間の札 (しま模様) はこの数を減らしません。",
        },
        {
          number: 4,
          name: "ブロックを作る",
          what: "作業の札を新しく 1 枚作るボタンです。",
          affects: "日時を入れずに作ると、右の「未配置」に入ります。",
        },
        {
          number: 5,
          name: "前週・今日・翌週",
          what: "表示する週を前後に動かします。「今日 (T)」で今週に戻ります。",
        },
        {
          number: 6,
          name: "週と月の切り替え",
          what: "1 週間の時間割と、1 か月のマス目を切り替えます。",
        },
        {
          number: 7,
          name: "7 日分の時間割",
          what: "予定が決まった作業が置かれる場所です。札はドラッグで動かせます。",
          affects: "動かすと、その札の日時がすぐ保存されます。取り消しはもう一度動かして直します。",
        },
        {
          number: 8,
          name: "未配置の置き場",
          what: "日時がまだ決まっていない作業の一覧です。かっこの中は枚数です。",
          affects: "ここから時間割へドラッグすると、その札は置き場から消えます。",
        },
      ],
      relations: [
        {
          label: "設定",
          href: "/admin/settings",
          why: "「週間稼働」で 1 週間に働ける時間を決めます。ここを変えると「今週あと〇時間」の数が変わります。",
        },
        {
          label: "作業種別",
          href: "/help/calendar-types",
          why: "札の色と、待ち時間あつかいにするかどうかを決めている画面です。",
        },
      ],
    },
    {
      id: "tray",
      heading: "未配置 (日程がまだの仕事)",
      body: [
        "右側の「未配置」は、やることは決まったけれど日時を決めていない仕事の置き場です。",
        "案件を **受注** に進めて受注書から作業を用意すると、ここに札がまとめて増えます。",
        "札は上から順に並びます。1 枚押すと詳細が開き、日時を数字で入れることもできます。",
      ],
      screenshot: trayShot,
      items: [
        {
          number: 1,
          name: "未配置の一覧",
          what: "日時が決まっていない作業の札です。丸い印は色、下の数字は予定の時間です。",
          affects: "札をつまんで時間割へ運ぶと予定になります。運んだ札はここから消えます。",
        },
        {
          number: 2,
          name: "自動で並べる",
          what: "未配置の札を、空いている時間へ順番に置く下書きを作ります。",
          affects: "押しただけでは予定は変わりません。「確定」を押すまで下書きのままです。",
        },
        {
          number: 3,
          name: "今週あと〇時間",
          what: "札を置いていくと、この残り時間が減っていきます。",
          affects: "働ける時間を超えるとマイナスになり、赤く出ます。",
        },
        {
          number: 4,
          name: "ブロックを作る",
          what: "案件と関係のない仕事 (工場の片づけなど) もここから作れます。",
        },
      ],
      relations: [
        {
          label: "案件",
          href: "/help/deals",
          why: "案件を「受注」にして受注書から作業を用意すると、その明細ぶんの札がここに増えます。",
        },
      ],
    },
    {
      id: "create",
      heading: "作業の札を作る",
      body: [
        "左上の **ブロックを作る** を押すと、この入力画面が出ます。",
        "時間割の空いているところを縦にドラッグしても、同じ画面が開きます。そのときは日時が先に入っています。",
        "案件とつなげておくと、案件の画面からも作業の進みぐあいが見えます。",
      ],
      screenshot: createShot,
      items: [
        {
          number: 1,
          name: "案件リンク",
          what: "この作業がどのお客様の仕事かを選びます。社内の用事なら空のままで大丈夫です。",
          affects: "選んだ案件の画面に、この作業が一覧で出るようになります。",
        },
        {
          number: 2,
          name: "種別",
          what: "研磨・下地・塗装などの作業の種類です。色と、待ち時間かどうかがここで決まります。",
          affects: "種類を変えると札の色が変わります。待ち時間の種類にすると残り時間を減らしません。",
        },
        {
          number: 3,
          name: "予定時間",
          what: "何時間かかる見込みかを書きます。0.25 (15 分) きざみで入れられます。",
          affects: "この数字が「今週あと〇時間」から引かれます。札の縦の長さにもなります。",
        },
        {
          number: 4,
          name: "今すぐカレンダーに配置する",
          what: "チェックを入れると、その場で日付と開始時刻を選べます。",
          affects: "チェックしなければ「未配置」に入ります。あとからいつでも置けます。",
        },
        {
          number: 5,
          name: "作成する",
          what: "札を作って画面に反映します。",
          affects: "受注前の案件に日時つきで置いた場合は、案件を「製作中」に進めるか確認が出ます。",
        },
      ],
      relations: [
        {
          label: "案件",
          href: "/admin/deals",
          why: "案件の画面の「新規作成」からカレンダーに来ると、案件が先に入った状態でこの画面が開きます。",
        },
      ],
    },
    {
      id: "detail",
      heading: "札を押したときの詳細",
      body: [
        "時間割の札や未配置の札を 1 回押すと、この画面が開きます。",
        "ドラッグが苦手なときは、ここで日付と時刻を選んで **移動する** を押せば同じことができます。",
        "**編集内容を保存** は Cmd (Ctrl) + S でも実行できます。",
      ],
      screenshot: detailShot,
      items: [
        {
          number: 1,
          name: "配置",
          what: "今の日時と、日付・時刻を選び直す欄です。まだ置いていない札では「配置する」と出ます。",
          affects: "「未配置に戻す」を押すと、予定が消えて右の置き場に戻ります。作業そのものは消えません。",
        },
        {
          number: 2,
          name: "内容の編集",
          what: "案件・種類・タイトル・予定時間・メモを直せます。",
          affects: "予定時間を変えると「今週あと〇時間」も変わります。",
        },
        {
          number: 3,
          name: "着手・キャンセル",
          what: "作業を始めたら「着手」、やらなくなったら「キャンセル」を押します。",
          affects: "着手にすると未配置には戻せなくなります。キャンセルした札は表から消えず、記録として残ります。",
        },
        {
          number: 4,
          name: "閉じる",
          what: "右上の×か、いちばん下の「閉じる」で戻ります。Esc キーでも閉じます。",
        },
      ],
      relations: [
        {
          label: "案件",
          href: "/help/deals",
          why: "作業を最初に日時へ置くと、その案件を「製作中」に進めるか確認が出ます。「はい」を押すと案件の段が動きます。",
        },
      ],
    },
    {
      id: "actual",
      heading: "かかった時間を記録する",
      body: [
        "詳細を下までスクロールすると、実際にかかった時間を書く欄があります。",
        "予定より長くかかった仕事が分かると、次の見積りの精度が上がります。",
        "完了したあとでも、同じ欄から数字を直せます。",
      ],
      screenshot: actualShot,
      items: [
        {
          number: 1,
          name: "実績を入れる",
          what: "実際にかかった時間と、作業した日を入れて保存します。",
          affects: "保存するとその作業は「完了」になり、予定との差が数字で出ます。",
        },
        {
          number: 2,
          name: "着手・キャンセル",
          what: "実績を入れる前に「着手」を押しておくと、今やっている作業がはっきりします。",
        },
        {
          number: 3,
          name: "詳細の画面",
          what: "上下にスクロールできます。上には日時、真ん中には内容の編集欄があります。",
        },
      ],
    },
    {
      id: "auto",
      heading: "自動で並べる",
      body: [
        "**自動で並べる** は、未配置の札を早い順に空いている時間へ入れる下書きを作ります。",
        "置き先は平日の 9 時から 18 時のあいだで、30 分きざみです。ほかの作業と重ならない場所を選びます。",
        "乾燥のような待ち時間の札は、直前の作業のうしろに続けて置かれます。夜や休日をまたいでもかまいません。",
        "2 週間さがしても置けない札があると、そこで下書きは打ち切られます。",
      ],
      screenshot: autoShot,
      items: [
        {
          number: 1,
          name: "提案のバー",
          what: "何件の下書きができたかが出ます。**確定** で本当の予定になり、**やめる** で消えます。",
          affects: "確定するまで予定は変わりません。Esc キーでもやめられます。",
        },
        {
          number: 2,
          name: "点線の札",
          what: "下書きの置き場所です。色は元の作業の色、枠が点線なのが目印です。",
        },
        {
          number: 3,
          name: "未配置の置き場",
          what: "確定するまで札はここに残ります。",
          affects: "確定すると札が置き場から消え、時間割に色つきで並びます。",
        },
        {
          number: 4,
          name: "今週あと〇時間",
          what: "確定したあとに数字が減ります。下書きの段階では変わりません。",
        },
      ],
    },
    {
      id: "month",
      heading: "月の表の見方",
      body: [
        "右上の **月 (M)** を押すと、1 か月ぶんのマス目になります。",
        "予定のある日には、作業の色の丸と件数だけが出ます。混み具合を見るための画面です。",
        "日のマスを押すと、その日を含む週の時間割に戻ります。",
      ],
      screenshot: monthShot,
      items: [
        {
          number: 1,
          name: "1 か月のマス目",
          what: "薄い文字の日は先月・翌月の日です。今日は色がついています。",
          affects: "日を押すとその週の時間割に切り替わります。",
        },
        {
          number: 2,
          name: "週と月の切り替え",
          what: "「週 (W)」で時間割に戻ります。W・M のキーでも切り替わります。",
        },
        {
          number: 3,
          name: "前月・今日・翌月",
          what: "表示する月を動かします。「今日 (T)」で今月に戻ります。",
        },
        {
          number: 4,
          name: "今週あと〇時間",
          what: "月の表にしても、この数字はいつも「今週」の残り時間です。",
        },
      ],
    },
  ],
  useCases: [
    {
      persona: "yamagishi",
      title: "受注した仕事を今週の予定に入れる",
      situation:
        "小林様の自動車パーツ塗装が受注になりました。研磨・下地・塗装・乾燥・検品を今週から来週に入れたい。",
      steps: [
        {
          action: "案件の画面で受注書から作業をまとめて用意する",
          where: "案件 → 小林様の案件 → 作業ブロックのカード → **作業ブロックを用意**",
          result: "工程ぶんの札ができます。日時はまだ入っていません。",
        },
        {
          action: "カレンダーを開いて右側を見る",
          where: "左のメニューの **カレンダー**",
          result: "「未配置」に用意した札が並んでいます。",
          screenshot: trayShot,
        },
        {
          action: "研磨の札を月曜の 9 時にドラッグする",
          where: "未配置の札 → 週の表の 9/7 (月) 09:00 のあたり",
          result: "札が時間割に置かれ、「今週あと〇時間」が 2 時間ぶん減ります。",
        },
        {
          action: "案件を「製作中」に進めるか聞かれたら「はい」を押す",
          where: "画面の下に出る小さな確認",
          result: "案件の段が「製作中」に変わり、事務の佐藤さんにも進みぐあいが伝わります。",
        },
        {
          action: "残りの札は「自動で並べる」に任せて確定する",
          where: "未配置の上の **自動で並べる** → **確定**",
          result: "下地・塗装・乾燥・検品が空いている時間に並びます。",
          screenshot: autoShot,
        },
      ],
      outcome: "1 週間の段取りが 5 分で決まり、当日は時間割どおりに手を動かすだけになります。",
    },
    {
      persona: "yamagishi",
      title: "塗装が長引いたので予定を組み直す",
      situation: "水曜の塗装が思ったより長引き、木曜の検品を後ろにずらしたい。",
      steps: [
        {
          action: "水曜の塗装の札を押して、かかった時間を書く",
          where: "週の表の札 → 詳細を下までスクロール → **実績を保存**",
          result: "その作業が完了になり、予定 3 時間・実績 4.5 時間のように差が出ます。",
          screenshot: actualShot,
        },
        {
          action: "木曜の検品の札を金曜へドラッグする",
          where: "週の表の札をつまんで右へ",
          result: "日付が金曜に変わり、すぐ保存されます。",
        },
        {
          action: "混み具合を月の表で見直す",
          where: "右上の **月 (M)**",
          result: "来週の空いている日が分かり、追加の仕事を入れる日を決められます。",
          screenshot: monthShot,
        },
      ],
      outcome: "遅れをその場で織り込み直せて、次の見積りに使える「実際にかかった時間」も残ります。",
    },
    {
      persona: "sato",
      title: "お客様から「いつ仕上がりますか」と電話が来た",
      situation: "事務の佐藤さんが、田中様から仕上がり予定を聞かれた。山岸さんは現場に出ている。",
      steps: [
        {
          action: "カレンダーを開いて週の表を見る",
          where: "左のメニューの **カレンダー**",
          result: "田中様の作業の札が何日に入っているかが分かります。",
          screenshot: weekShot,
        },
        {
          action: "札を押して詳細を開く",
          where: "週の表の札を 1 回押す",
          result: "案件の名前・予定の日時・メモが読めます。乾燥に半日かかることも分かります。",
          screenshot: detailShot,
        },
        {
          action: "検品の日を確認してお客様に伝える",
          where: "詳細の「配置」に出ている日時",
          result: "「金曜の午前に塗って、翌日の検品後に発送です」と答えられます。",
        },
      ],
      outcome: "山岸さんに電話でつながらなくても、その場で仕上がり予定を答えられます。",
    },
  ],
  faqs: [
    {
      q: "札を動かしたのに保存されません。",
      a: "動かした直後に赤い知らせが出ていないか見てください。ほかの人が先に同じ札を直していると、上書きしないで知らせる作りになっています。画面を再読み込みして、新しい内容を見てからもう一度動かしてください。",
    },
    {
      q: "作った札が見つかりません。",
      a: "まず右の「未配置」を見てください。日時を入れずに作った札はそこに入ります。日時を入れた札なら、その日の週へ「前週・翌週」で移動するか、月の表で色の丸が出ている日を探してください。",
    },
    {
      q: "同じ作業の札が二重にできてしまいました。",
      a: "受注書から作業を用意する操作を 2 回押すと増えることがあります。いらない札を押して詳細を開き、「キャンセル」または「削除」で片づけてください。日時が入っている札は、先に「未配置に戻す」を押すと削除できます。",
    },
    {
      q: "間違えて札を消してしまいました。",
      a: "消した札は元に戻せません。同じ内容で作り直してください。消す前に迷ったときは、削除ではなく「キャンセル」を選ぶと記録が残ります。",
    },
    {
      q: "「今週あと〇時間」が赤いマイナスになっています。",
      a: "その週に入れた作業の合計が、働ける時間を超えています。札を来週へずらすか、設定の「週間稼働」で働ける時間を見直してください。マイナスのままでも保存はできます。",
    },
    {
      q: "乾燥の札を入れても残り時間が減りません。",
      a: "乾燥のように人が張りつかない作業は、はじめから残り時間を減らさない設定になっています。作業種別の画面で「拘束」のチェックを外した種類がこれにあたります。",
    },
    {
      q: "「自動で並べる」を押しても何も起きません。",
      a: "「未配置のブロックがありません」と出た場合は、置く札そのものがありません。「配置できる候補が見つかりませんでした」と出た場合は、2 週間先まで空きが無い状態です。既にある予定を減らすか、日を空けてからもう一度押してください。",
    },
    {
      q: "自動で並べた場所が気に入りません。",
      a: "点線のうちは下書きです。「やめる」か Esc キーで消えます。確定したあとでも、札をドラッグすればいつでも動かせます。",
    },
    {
      q: "夜や早朝の予定が見えません。",
      a: "時間割は 0 時から 24 時まであり、はじめは朝 7 時のあたりが見えています。表の中で上下にスクロールしてください。",
    },
    {
      q: "札の長さを変えたいです。",
      a: "札の下の端にカーソルを合わせると縦向きの矢印になります。そのまま下へ引っぱると 30 分きざみで長くなります。詳細画面の「予定時間」を直しても構いません。",
    },
    {
      q: "案件とつながっていない予定は作れますか。",
      a: "作れます。「ブロックを作る」で案件を選ばずに保存してください。工場の片づけや道具の点検などに使えます。",
    },
    {
      q: "スマートフォンでも見られますか。",
      a: "見られます。画面がせまいときは 1 日ぶんの表示に切り替わります。日付を選んで、その日の予定と未配置の札を確認できます。",
    },
    {
      q: "札に点がついていたり、点線の赤い枠になっています。",
      a: "外部のカレンダーとやりとりしている印です。赤い点線は「外のカレンダーで消された」という意味です。札を押すと「未配置に戻す」「キャンセルする」「作り直して再送」から選べます。",
    },
    {
      q: "完了にした作業の時間を書き間違えました。",
      a: "その札をもう一度押すと、下のほうに同じ「実績を入れる」の欄が出ます。正しい数字を入れて保存すれば上書きできます。",
    },
  ],
  related: [
    { label: "カレンダー — 作業種別", href: "/help/calendar-types" },
    { label: "カレンダー — テンプレート", href: "/help/calendar-templates" },
    { label: "カレンダー — 外部連携", href: "/help/calendar-connections" },
    { label: "案件", href: "/help/deals" },
    { label: "見積書・請求書", href: "/help/documents" },
    { label: "やること", href: "/help/tasks" },
    { label: "今日の仕事", href: "/help/dashboard" },
    { label: "設定 (週間稼働)", href: "/admin/settings" },
  ],
  glossary: [
    { term: "作業ブロック (札)", meaning: "研磨や塗装など、ひとまとまりの作業 1 つぶんの予定です。" },
    { term: "未配置", meaning: "やることは決まっているが、日時をまだ決めていない状態です。" },
    { term: "拘束", meaning: "人が張りついて手を動かす作業のことです。週の残り時間から引かれます。" },
    { term: "非拘束 (待ち時間)", meaning: "乾燥のように置いておくだけの時間です。残り時間から引かれません。" },
    { term: "週間稼働", meaning: "1 週間に作業に使える時間の上限です。設定の画面で決めます。" },
  ],
};
