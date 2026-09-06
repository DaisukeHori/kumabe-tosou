import { createAnnotator, type HelpShotJson } from "../annotate";
import type { HelpDoc } from "../types";

import overviewJson from "../../../public/help/costs/01-overview.json";
import summaryJson from "../../../public/help/costs/02-summary.json";
import chartJson from "../../../public/help/costs/03-chart.json";
import breakdownJson from "../../../public/help/costs/04-breakdown.json";
import lastMonthJson from "../../../public/help/costs/05-last-month.json";

/**
 * 「AI 利用料金」(/admin/costs) のヘルプ本文。
 * 注釈の座標は撮影時に記録した JSON から組み立てる (手打ちしない)。
 */
const overview = createAnnotator(overviewJson as HelpShotJson);
const summary = createAnnotator(summaryJson as HelpShotJson);
const chart = createAnnotator(chartJson as HelpShotJson);
const breakdown = createAnnotator(breakdownJson as HelpShotJson);
const lastMonth = createAnnotator(lastMonthJson as HelpShotJson);

const overviewShot = overview.screenshot({
  src: "/help/costs/01-overview.png",
  alt: "AI 利用料金の画面全体。上に今月の合計と画像の枚数、真ん中に棒グラフ、下に 3 つの内訳表が並ぶ。",
  caption: "上から「今月いくら」「毎日いくら」「何にいくら」の順に並びます。",
  annotations: [
    overview.box("page-header", 1),
    overview.badge("help-button", 2),
    overview.box("cost-total", 3),
    overview.box("cost-images", 4),
    overview.box("cost-chart", 5),
    overview.box("cost-period", 6),
    overview.box("cost-breakdown", 7),
  ],
});

const summaryShot = summary.screenshot({
  src: "/help/costs/02-summary.png",
  alt: "今月の合計金額と月次予算のバー、画像生成の枚数と上限のバーが横に 2 つ並んでいる。",
  caption: "左がお金、右が画像の枚数です。どちらも棒の伸び具合で残りが分かります。",
  annotations: [
    summary.box("cost-total", 1),
    summary.box("cost-budget-bar", 2),
    summary.box("cost-images", 3),
    summary.box("cost-image-bar", 4),
  ],
});

const chartShot = chart.screenshot({
  src: "/help/costs/03-chart.png",
  alt: "直近 30 日の棒グラフ。1 日 1 本の棒が色で 3 つに分かれ、下に色の説明と期間の切り替えがある。",
  caption: "1 本が 1 日ぶんです。色は、どの会社の仕組みを使ったかを表します。",
  annotations: [
    chart.box("cost-chart", 1),
    chart.box("cost-chart-graph", 2),
    chart.box("cost-chart-legend", 3),
    chart.box("cost-period", 4),
  ],
});

const breakdownShot = breakdown.screenshot({
  src: "/help/costs/04-breakdown.png",
  alt: "モデル別・キー別・feature別の 3 つの内訳表が横に並び、それぞれ金額の多い順に並んでいる。",
  caption: "同じ金額を 3 つの見方に分けた表です。合計はどれも同じになります。",
  annotations: [
    breakdown.box("cost-by-model", 1),
    breakdown.box("cost-by-key", 2),
    breakdown.box("cost-by-feature", 3),
  ],
});

const lastMonthShot = lastMonth.screenshot({
  src: "/help/costs/05-last-month.png",
  alt: "期間を「先月」に切り替えた直後の画面。3 つの内訳表の金額が先月ぶんに入れ替わっている。",
  caption: "「先月」を押した直後。内訳の金額がまるごと入れ替わります。",
  annotations: [
    lastMonth.box("cost-period", 1),
    lastMonth.box("cost-by-model", 2),
    lastMonth.box("cost-by-key", 3),
    lastMonth.box("cost-by-feature", 4),
  ],
});

export const doc: HelpDoc = {
  slug: "costs",
  title: "AI 利用料金",
  adminPath: "/admin/costs",
  summary: [
    "文章づくりや画像づくりに使った AI の料金が、今月いくらかを確かめられます。",
    "今月の上限 (予算) に対して、どこまで使ったかを棒の伸び具合で確かめられます。",
    "画像を今月何枚作ったか、あと何枚作れるかを確かめられます。",
    "毎日いくら使ったかを、30 日ぶんのグラフで確かめられます。",
    "何にお金がかかっているかを、3 つの見方 (種類・鍵・用途) で確かめられます。",
    "今月・先月・直近 30 日の 3 つで、期間を切り替えて比べられます。",
  ],
  flow: [
    {
      step: "左のメニューの「AI利用料金」を開く",
      where: "メニューの **その他** の中",
      result: "今月の合計金額が、いちばん上に大きく出ます。",
    },
    {
      step: "予算の棒がどこまで伸びているか見る",
      where: "画面左上のカードの下の細い棒",
      result: "「$16.75 / $50.00」のように、使った額と上限が並びます。",
    },
    {
      step: "画像の枚数を見る",
      where: "画面右上のカード",
      result: "「24 / 200 枚」のように、今月作った枚数と上限が出ます。",
    },
    {
      step: "グラフで使いすぎた日を探す",
      where: "真ん中の棒グラフ",
      result: "1 本だけ高い日があれば、その日に何かをまとめて作ったと分かります。",
    },
    {
      step: "下の 3 つの表で中身を調べる",
      where: "画面下の **モデル別 / キー別 / feature別 (用途別)** の表",
      result: "どの用途にいくらかかっているかが、多い順に並びます。",
    },
    {
      step: "期間を「先月」に切り替えて比べる",
      where: "グラフの下の **今月 / 先月 / 30日** の丸いボタン",
      result: "下の 3 つの表が、その期間の金額に入れ替わります。",
    },
  ],
  sections: [
    {
      id: "overview",
      heading: "画面全体の並び",
      body: [
        "この画面は **見るだけ** の画面です。数字を変えたり消したりはできません。",
        "上から「今月いくら」「毎日いくら」「何にいくら」の順に並んでいます。",
        "金額はアメリカドル ($) で出ます。1 ドルはおよそ 150 円と考えると見当がつきます。",
      ],
      screenshot: overviewShot,
      items: [
        {
          number: 1,
          name: "見出しと説明",
          what: "画面の名前です。この画面が何を出しているかが 1 行で書いてあります。",
        },
        {
          number: 2,
          name: "「?」ボタン",
          what: "今見ている画面の使い方 (このページ) を別の窓で開きます。",
        },
        {
          number: 3,
          name: "今月の合計と予算",
          what: "今月に使った金額と、月の上限に対する伸び具合です。",
          affects: "上限は設定の「運用上限」で決めます。上限に届くと、AI を使う機能が止まります。",
        },
        {
          number: 4,
          name: "画像生成枚数",
          what: "今月作った画像の枚数と、月に作れる上限です。",
          affects: "上限に届くと、発信スタジオなどで新しい画像を作れなくなります。",
        },
        {
          number: 5,
          name: "日別の棒グラフ",
          what: "直近 30 日ぶん、1 日 1 本の棒で使った額を表します。",
          affects: "期間を切り替えてもグラフは 30 日のままです。変わるのは下の表だけです。",
        },
        {
          number: 6,
          name: "期間の切り替え",
          what: "今月・先月・直近 30 日を選べます。今開いているものは黒く塗られます。",
          affects: "下の 3 つの表の中身が入れ替わります。",
        },
        {
          number: 7,
          name: "3 つの内訳表",
          what: "同じ金額を、種類ごと・鍵ごと・用途ごとに分けた表です。",
          affects: "3 つとも合計は同じです。見方が違うだけです。",
        },
      ],
      relations: [
        {
          label: "設定",
          href: "/admin/settings",
          why: "月の上限 (金額・画像の枚数) と、使う鍵はここで決めます。",
        },
        {
          label: "発信スタジオ (音声から記事・投稿を作る)",
          href: "/admin/studio",
          why: "ここで記事や画像を作ると、この画面の金額が増えます。",
        },
      ],
    },
    {
      id: "summary",
      heading: "今月の合計と上限の見方",
      body: [
        "左が **お金**、右が **画像の枚数** です。どちらも「使った分 / 上限」で並びます。",
        "棒が右端まで伸びると、その月はもう使えません。",
        "上限に近づいてきたら、設定で上限を見直すか、翌月まで待ちます。",
      ],
      screenshot: summaryShot,
      items: [
        {
          number: 1,
          name: "今月の合計",
          what: "大きい数字が、今月これまでに使った合計金額です。",
          affects: "記事や画像を作るたびに増えます。翌月 1 日に 0 から数え直します。",
        },
        {
          number: 2,
          name: "月次予算の棒",
          what: "「使った額 / 上限」と、その伸び具合を表す棒です。",
          affects: "上限に届くと、記事づくりや画像づくりが「上限に達しました」で止まります。",
        },
        {
          number: 3,
          name: "画像生成枚数",
          what: "今月作った画像の枚数です。1 回で 4 枚作ると 4 枚と数えます。",
          affects: "選ばずに捨てた画像も枚数に入ります。作りすぎに注意します。",
        },
        {
          number: 4,
          name: "画像生成上限の棒",
          what: "月に作れる枚数に対する、今の伸び具合です。",
          affects: "右端まで伸びると、その月は新しい画像を作れません。",
        },
      ],
      relations: [
        {
          label: "設定",
          href: "/admin/settings",
          why: "月にいくらまで・何枚まで使うかは、運用上限のタブで決めます。",
        },
      ],
    },
    {
      id: "chart",
      heading: "日別のグラフの読み方",
      body: [
        "棒 1 本が 1 日ぶんです。左が古い日、右が新しい日です。",
        "棒の色は、どの会社の仕組みを使ったかを表します。色の説明はグラフのすぐ下にあります。",
        "棒にマウスを乗せると、その日の金額が小さく出ます。",
      ],
      screenshot: chartShot,
      items: [
        {
          number: 1,
          name: "グラフの箱",
          what: "直近 30 日ぶんをまとめて見せます。期間を切り替えてもここは変わりません。",
        },
        {
          number: 2,
          name: "棒グラフ本体",
          what: "1 本が 1 日です。高いほどその日にたくさん使ったという意味です。",
          affects: "1 本だけ飛び抜けて高い日は、まとめて記事や画像を作った日です。",
        },
        {
          number: 3,
          name: "色の説明",
          what: "どの色がどの会社かを表します。棒の中の色の割合で、使い分けが分かります。",
        },
        {
          number: 4,
          name: "期間の切り替え",
          what: "今月・先月・直近 30 日から選びます。",
          affects: "押すと画面が開き直り、下の 3 つの表だけが入れ替わります。",
        },
      ],
      relations: [
        {
          label: "通話 (着信・留守電・文字起こし)",
          href: "/admin/calls",
          why: "留守番電話の文字起こしを使うと、その日の棒が少し高くなります。",
        },
      ],
    },
    {
      id: "breakdown",
      heading: "3 つの内訳表の使い分け",
      body: [
        "同じ金額を 3 つの見方で分けています。**合計はどれも同じ** です。",
        "「何にお金がかかっているか」を知りたいときは、いちばん右の表を見ます。",
        "どの表も、金額の多い順に上から並びます。",
      ],
      screenshot: breakdownShot,
      items: [
        {
          number: 1,
          name: "モデル別",
          what: "使った AI の種類ごとの金額です。上の色つきの札が会社名、下の細かい字が種類の名前です。",
          affects: "設定で使う種類を変えると、ここに出る名前も変わります。",
        },
        {
          number: 2,
          name: "キー別",
          what: "登録してある鍵ごとの金額です。鍵は AI を使うための合い言葉のようなものです。",
          affects: "「キー未指定」は、鍵を登録する前に使ったぶんです。過去の記録なので消えません。",
        },
        {
          number: 3,
          name: "feature別 (用途別)",
          what: "何のために使ったかごとの金額です。記事づくり・画像づくり・通話の文字起こしなどに分かれます。",
          affects: "特定の用途だけ金額が大きいときは、その機能の使い方を見直す目安になります。",
        },
      ],
      relations: [
        {
          label: "設定",
          href: "/admin/settings",
          why: "鍵の登録と、使う AI の種類はここで決めます。",
        },
        {
          label: "SNS の接続と配信",
          href: "/admin/channels",
          why: "投稿用の画像を作ると、用途別の表の画像づくりの金額が増えます。",
        },
      ],
    },
    {
      id: "period",
      heading: "期間を切り替えて比べる",
      body: [
        "丸いボタンで、今月・先月・直近 30 日を切り替えられます。",
        "切り替わるのは **下の 3 つの表だけ** です。上の合計とグラフは今月と 30 日のままです。",
        "先月と今月を見比べると、使い方が増えているかどうかが分かります。",
      ],
      screenshot: lastMonthShot,
      items: [
        {
          number: 1,
          name: "選ばれている期間",
          what: "黒く塗られているものが、今出している期間です。",
          affects: "押すと画面の住所 (アドレス) が変わるので、そのまま印刷や共有ができます。",
        },
        {
          number: 2,
          name: "モデル別 (期間ぶん)",
          what: "その期間に使った AI の種類ごとの金額です。",
        },
        {
          number: 3,
          name: "キー別 (期間ぶん)",
          what: "その期間に使った鍵ごとの金額です。",
        },
        {
          number: 4,
          name: "feature別 (期間ぶん)",
          what: "その期間の用途ごとの金額です。先月と見比べると増減が分かります。",
        },
      ],
      relations: [
        {
          label: "今日の仕事",
          href: "/admin",
          why: "毎日の状況をまとめて見たいときは、こちらの画面から始めます。",
        },
      ],
    },
  ],
  useCases: [
    {
      persona: "sato",
      title: "月末に、AI にいくら使ったかを代表に報告する",
      situation: "月末の報告書に、今月の AI の費用を 1 行書きたい。",
      steps: [
        {
          action: "左のメニューの「AI利用料金」を開く",
          where: "メニューの「その他」の中",
          result: "いちばん上に今月の合計が大きく出ます。",
          screenshot: summaryShot,
        },
        {
          action: "「今月の合計」と、その下の「$16.75 / $50.00」を書き写す",
          where: "画面左上のカード",
          result: "今月いくら使い、上限に対して何割かが分かります。",
        },
        {
          action: "期間を「先月」に切り替えて、内訳の合計を見比べる",
          where: "グラフの下の丸いボタン",
          result: "先月より増えたか減ったかが分かります。",
          screenshot: lastMonthShot,
        },
      ],
      outcome: "「今月は上限の 3 分の 1 で、先月より少し減りました」と報告できます。",
    },
    {
      persona: "yamagishi",
      title: "急に料金が増えた日を調べる",
      situation: "今月の金額が思ったより多い。何にたくさん使ったのか知りたい。",
      steps: [
        {
          action: "真ん中の棒グラフで、飛び抜けて高い棒を探す",
          where: "画面中央のグラフ",
          result: "1 本だけ高い日が見つかります。棒にマウスを乗せると日付と金額が出ます。",
          screenshot: chartShot,
        },
        {
          action: "下の「feature別」の表で、いちばん上の行を見る",
          where: "画面下の右端の表",
          result: "記事づくりが多いのか、画像づくりが多いのかが分かります。",
          screenshot: breakdownShot,
        },
        {
          action: "その機能の画面を開いて、作りすぎていないか確かめる",
          where: "左のメニューの「発信スタジオ」など",
          result: "同じ内容を何度も作り直していた、といった原因が見つかります。",
        },
      ],
      outcome: "増えた理由がはっきりし、翌月の使い方を決められます。",
    },
    {
      persona: "sato",
      title: "画像が作れなくなったので、残りの枚数を確かめる",
      situation: "発信スタジオで画像を作ろうとしたら、上限に達したと出て作れない。",
      steps: [
        {
          action: "「AI利用料金」を開き、右上のカードを見る",
          where: "画面右上の「画像生成枚数 (今月)」",
          result: "「200 / 200 枚」のように、上限まで使い切っていることが分かります。",
          screenshot: summaryShot,
        },
        {
          action: "設定の運用上限で、月に作れる枚数を確かめる",
          where: "左のメニューの「設定」",
          result: "上限を増やすか、翌月まで待つかを判断できます。",
        },
        {
          action: "急ぎでなければ、翌月 1 日まで待つ",
          where: "—",
          result: "月が変わると枚数は 0 に戻り、また作れるようになります。",
        },
      ],
      outcome: "作れない理由がはっきりし、あわてて設定をいじらずに済みます。",
    },
  ],
  faqs: [
    {
      q: "金額が「$0.00」のままです。",
      a: "その期間に AI をまだ使っていない状態です。記事や画像を作ると数字が入ります。今月ではなく先月に使っていた場合は、期間を「先月」に切り替えて確かめてください。",
    },
    {
      q: "表に「データがありません」と出ます。",
      a: "選んでいる期間に記録が 1 件も無いという意味です。期間を「30日」に切り替えると、直近のぶんが見つかることがあります。",
    },
    {
      q: "上限に達して、記事や画像を作れなくなりました。",
      a: "その月に使える金額か枚数を使い切った状態です。設定の運用上限で上限を上げるか、翌月まで待ってください。月が変わると 0 から数え直します。",
    },
    {
      q: "上の合計と、下の表の合計が合いません。",
      a: "上の合計は今月ぶん、下の表は選んでいる期間ぶんです。期間を「今月」にすると同じ金額になります。",
    },
    {
      q: "予算のバーの数字と、上の合計が少し違います。",
      a: "バーには「これから使う分として取り置きしてある額」も含まれます。処理が終わると取り置きは実際の額に置き換わり、差はなくなります。",
    },
    {
      q: "同じ金額が二重に数えられていませんか。",
      a: "二重にはなりません。1 回の利用が 1 件として記録され、3 つの表はその同じ記録を違う切り口で分けているだけです。3 つの表の合計はいつも同じになります。",
    },
    {
      q: "「キー未指定」とは何ですか。",
      a: "鍵を登録する前に使ったぶん、という意味です。過去の記録なので消えません。今後の利用には、登録した鍵の名前が付きます。",
    },
    {
      q: "「feature」の欄に英語が並んでいて読めません。",
      a: "使った目的を表す短い名前です。記事づくり、投稿用の画像づくり、通話の文字起こし、通話の要約、文章の下書きなどを表しています。金額の大小だけ見れば十分です。",
    },
    {
      q: "記録を間違えて消してしまうことはありますか。",
      a: "ありません。この画面は見るだけで、消すボタンも直すボタンもありません。安心してクリックして構いません。",
    },
    {
      q: "円で表示できますか。",
      a: "できません。アメリカドルのみです。おおよその円は、金額に 150 を掛けると見当がつきます。",
    },
    {
      q: "期間を間違えて切り替えました。元に戻せますか。",
      a: "「今月」を押せば元に戻ります。データは何も変わらないので、何度切り替えても問題ありません。",
    },
    {
      q: "グラフが 30 日のまま変わりません。",
      a: "グラフはいつも直近 30 日ぶんです。期間の切り替えで入れ替わるのは、下の 3 つの表だけです。",
    },
    {
      q: "この画面は職人にも見せてよいですか。",
      a: "管理者としてログインできる人だけが見られる画面です。ログインしていない人には見えません。",
    },
  ],
  related: [
    { label: "設定", href: "/help/settings" },
    { label: "発信スタジオ (音声から記事・投稿を作る)", href: "/help/studio" },
    { label: "SNS の接続と配信", href: "/help/channels" },
    { label: "通話 (着信・留守電・文字起こし)", href: "/help/calls" },
    { label: "今日の仕事", href: "/help/dashboard" },
  ],
  glossary: [
    {
      term: "AI",
      meaning: "文章や画像を自動で作ってくれる仕組みです。使うたびに少しずつ料金がかかります。",
    },
    {
      term: "モデル",
      meaning: "AI の種類のことです。種類ごとに得意なことと料金が違います。",
    },
    {
      term: "キー (鍵)",
      meaning: "AI を使うための合い言葉です。どの鍵で使ったかで料金を分けて数えられます。",
    },
    {
      term: "月次予算",
      meaning: "その月に AI へ使ってよい金額の上限です。届くと自動で止まります。",
    },
  ],
};
