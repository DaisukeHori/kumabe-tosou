import { createAnnotator, type HelpShotJson } from "../annotate";
import type { HelpDoc } from "../types";

import listJson from "../../../public/help/calendar-templates/01-list.json";
import newJson from "../../../public/help/calendar-templates/02-new.json";
import editJson from "../../../public/help/calendar-templates/03-edit.json";

/**
 * カレンダー — テンプレート (/admin/calendar/templates) のヘルプ本文。
 * canonical: docs/design/admin-help/README.md §3・§4。
 * 注釈の座標は撮影時に記録した JSON から組み立てる (手打ちしない)。
 */
const list = createAnnotator(listJson as HelpShotJson);
const create = createAnnotator(newJson as HelpShotJson);
const edit = createAnnotator(editJson as HelpShotJson);

const listShot = list.screenshot({
  src: "/help/calendar-templates/01-list.png",
  alt: "工数テンプレートの一覧。名称・グレード・サイズ・明細数・有効の列が並んでいる。",
  caption: "登録されているセットの一覧です。行を押すと中身を直せます。",
  annotations: [
    list.box("page-header", 1),
    list.badge("help-button", 2),
    list.box("template-new", 3),
    list.box("template-table", 4),
  ],
});

const createShot = create.screenshot({
  src: "/help/calendar-templates/02-new.png",
  alt: "テンプレートの新規作成画面。名称、グレードとサイズ帯、有効のチェック、明細の欄がある。",
  caption: "新しいセットを作るときの入力画面です。",
  annotations: [
    create.box("template-name", 1),
    create.box("template-grade-size", 2),
    create.box("template-items", 3),
    create.badge("template-dialog", 4),
  ],
});

const editShot = edit.screenshot({
  src: "/help/calendar-templates/03-edit.png",
  alt: "既存のセットを開いたところ。明細に研磨・下地・塗装・乾燥・検品と時間が並んでいる。",
  caption: "既にあるセットを開くと、工程と時間がそのまま出ます。",
  annotations: [
    edit.box("template-name", 1),
    edit.box("template-grade-size", 2),
    edit.box("template-items", 3),
    edit.badge("template-dialog", 4),
  ],
});

export const doc: HelpDoc = {
  slug: "calendar-templates",
  title: "カレンダー — テンプレート",
  adminPath: "/admin/calendar/templates",
  summary: [
    "「この仕上げでこの大きさなら、いつもこの工程」という組み合わせを登録できます。",
    "受注書から作業の予定をまとめて作るとき、ここに登録したセットが使われます。",
    "工程ごとの標準の時間を決めておけるので、毎回入力しなくてすみます。",
    "使わなくなったセットは、消さずに「無効」にしてしまっておけます。",
  ],
  flow: [
    {
      step: "テンプレートの画面を開く",
      where: "カレンダー → 右上の **カレンダー設定** → **テンプレート**",
      result: "登録済みのセットが一覧で出ます。",
    },
    {
      step: "新しいセットを作る",
      where: "右上の **新規作成**",
      result: "名前・対象・工程を入れる画面が開きます。",
    },
    {
      step: "対象を決める",
      where: "**グレード** と **サイズ帯** の欄",
      result: "どんな仕事にこのセットを使うかが決まります。両方「全対象」にすると、ほかに合うものが無いときの受け皿になります。",
    },
    {
      step: "工程と時間を並べる",
      where: "**明細** の欄と **明細を追加**",
      result: "研磨 2 時間、塗装 3 時間…のように 1 行ずつ足せます。",
    },
    {
      step: "保存する",
      where: "右下の **保存**",
      result: "一覧に並びます。次に受注書から作業を用意するときから使われます。",
    },
  ],
  sections: [
    {
      id: "list",
      heading: "一覧の見方",
      body: [
        "登録済みのセットが並びます。行をクリックすると中身を開けます。",
        "「グレード」は仕上げの等級、「サイズ帯」は品物の大きさの区分です。どちらも価格表で決めた区分を使います。",
        "「(全対象)」は「等級や大きさを問わず使う」という意味です。",
        "「明細数」はそのセットに入っている工程の数です。",
      ],
      screenshot: listShot,
      items: [
        {
          number: 1,
          name: "見出しと説明",
          what: "この画面の名前と、左上の「予定表へ」でカレンダーに戻るリンクです。",
        },
        {
          number: 2,
          name: "「?」ボタン",
          what: "今ご覧になっているこの説明を開くボタンです。",
        },
        {
          number: 3,
          name: "新規作成",
          what: "新しいセットを作ります。",
          affects: "作業の種類が 1 つも無いと押せません。先に作業種別を登録してください。",
        },
        {
          number: 4,
          name: "セットの一覧",
          what: "名前・対象・工程数・有効かどうかが並びます。右端の「削除」でその行を消せます。",
          affects: "「無効」にしたセットは、受注書から作業を用意するときに使われなくなります。",
        },
      ],
      relations: [
        {
          label: "価格表",
          href: "/admin/prices",
          why: "ここで選べるグレードとサイズ帯は、価格表で決めた区分です。価格表を直すと選べる中身も変わります。",
        },
        {
          label: "作業種別",
          href: "/help/calendar-types",
          why: "明細で選ぶ工程の名前と色は、作業種別の画面で決めます。",
        },
      ],
    },
    {
      id: "new",
      heading: "新しいセットを作る",
      body: [
        "**新規作成** を押すと、この画面が開きます。",
        "名前は自分たちが分かる言い方で構いません (例: 標準塗装セット (小物))。",
        "工程は上から順に並びます。並び順の数字が小さいものが先です。",
      ],
      screenshot: createShot,
      items: [
        {
          number: 1,
          name: "名称",
          what: "セットの名前です。一覧に出ます。",
        },
        {
          number: 2,
          name: "グレードとサイズ帯",
          what: "このセットを使う対象です。どちらも「(全対象)」のままでも作れます。",
          affects: "同じ組み合わせのセットは 1 つだけにしてください。近い順に 1 つが選ばれます。",
        },
        {
          number: 3,
          name: "明細 (工程と時間)",
          what: "左が工程、真ん中が標準の時間、右が並び順です。**明細を追加** で行を増やせます。",
          affects: "ここに書いた時間が、そのまま作業の予定時間になります。",
        },
        {
          number: 4,
          name: "保存とキャンセル",
          what: "右下の「保存」で登録します。Cmd (Ctrl) + S でも保存できます。Esc で閉じます。",
        },
      ],
    },
    {
      id: "edit",
      heading: "既にあるセットを直す",
      body: [
        "一覧の行を押すと、同じ画面が中身の入った状態で開きます。",
        "工程を減らしたいときは、その行の **削除** を押します。最後の 1 行は消せません。",
        "しばらく使わないセットは「有効」のチェックを外して残しておけます。",
      ],
      screenshot: editShot,
      items: [
        {
          number: 1,
          name: "名称",
          what: "名前を直せます。既にできている予定の名前は変わりません。",
        },
        {
          number: 2,
          name: "グレードとサイズ帯",
          what: "対象を変えると、次からどの仕事に使われるかが変わります。",
          affects: "対象を変えても、前に作った予定はそのままです。",
        },
        {
          number: 3,
          name: "明細 (工程と時間)",
          what: "工程の入れ替え・時間の変更・行の追加と削除ができます。",
          affects: "変更は次に作業を用意するときから使われます。",
        },
        {
          number: 4,
          name: "保存とキャンセル",
          what: "直したら「保存」を押します。押さずに閉じると変更は消えます。",
        },
      ],
      relations: [
        {
          label: "カレンダー (作業予定)",
          href: "/help/calendar",
          why: "ここで作ったセットから、カレンダーの「未配置」に札がまとめて増えます。",
        },
      ],
    },
  ],
  useCases: [
    {
      persona: "yamagishi",
      title: "小物の標準工程を登録して、毎回の入力をやめる",
      situation:
        "小さなフィギュアの塗装は、いつも同じ順番で進めている。研磨 2 時間・下地 1.5 時間・塗装 3 時間・乾燥 12 時間・検品 0.5 時間。",
      steps: [
        {
          action: "テンプレートの画面を開く",
          where: "カレンダー → **カレンダー設定** → **テンプレート**",
          result: "登録済みのセットが並びます。",
          screenshot: listShot,
        },
        {
          action: "新規作成を押して名前と対象を入れる",
          where: "右上の **新規作成** → 名称に「標準塗装セット (小物)」、グレードとサイズ帯を選ぶ",
          result: "この組み合わせの仕事にだけ使われるセットになります。",
          screenshot: createShot,
        },
        {
          action: "工程を 5 行ならべて保存する",
          where: "明細の欄 → **明細を追加** をくり返す → **保存**",
          result: "一覧に「明細数 5」で並びます。",
        },
        {
          action: "受注した案件で作業を用意する",
          where: "案件 → 受注書のカード → **作業ブロックを用意**",
          result: "カレンダーの「未配置」に 5 枚の札が自動でできます。",
        },
      ],
      outcome: "受注のたびに工程を打ち込む手間がなくなり、抜け漏れも防げます。",
    },
    {
      persona: "sato",
      title: "使わなくなったセットをしまう",
      situation: "特殊コーティングの取り扱いをやめたので、そのセットを使わないようにしたい。",
      steps: [
        {
          action: "一覧でそのセットの行を押す",
          where: "テンプレートの一覧",
          result: "中身が開きます。",
          screenshot: listShot,
        },
        {
          action: "「有効」のチェックを外して保存する",
          where: "**有効** のチェック → **保存**",
          result: "一覧の表示が「無効」に変わります。",
          screenshot: editShot,
        },
      ],
      outcome: "過去の記録は残したまま、これから作る予定には使われなくなります。",
    },
  ],
  faqs: [
    {
      q: "保存できません。",
      a: "名前が空になっていないか、明細の工程が選ばれていないかを見てください。時間は 0 以上の数字が必要です。赤い文字で出ている案内がそのまま原因です。",
    },
    {
      q: "作ったセットが受注の作業に使われません。",
      a: "「有効」になっているか、グレードとサイズ帯がその仕事と合っているかを確かめてください。どれとも合わない場合は、両方を「(全対象)」にしたセットが受け皿になります。",
    },
    {
      q: "同じ対象のセットを 2 つ作ったらどうなりますか。",
      a: "どちらか 1 つだけが使われ、どちらが選ばれるかははっきりしません。対象の組み合わせは 1 つずつにしてください。",
    },
    {
      q: "セットが一覧に見つかりません。",
      a: "この一覧には無効のものも出ます。名前を変えていないか、削除していないかを確かめてください。削除したものは戻せません。",
    },
    {
      q: "間違えて削除してしまいました。",
      a: "元に戻す機能はありません。同じ内容でもう一度作ってください。使わなくなっただけなら、次からは削除ではなく「有効」のチェックを外してください。",
    },
    {
      q: "セットを直したら、前に作った予定も変わりますか。",
      a: "変わりません。カレンダーにできあがった札は、作った時点の内容のままです。直したい札は、カレンダーで 1 枚ずつ開いて変更してください。",
    },
    {
      q: "工程を並べ替えたいです。",
      a: "各行の右にある「並び順」の数字を変えてください。小さい数字が先に来ます。",
    },
    {
      q: "明細を 1 行だけにしたいのに削除ボタンが押せません。",
      a: "最後の 1 行は残す決まりです。工程を入れ替えたいときは、先に新しい行を足してから古い行を消してください。",
    },
    {
      q: "「先に作業種別を登録してください」と出て新規作成が押せません。",
      a: "工程として選べる作業の種類がまだ 1 つもありません。作業種別の画面で、研磨や塗装などを先に登録してください。",
    },
    {
      q: "グレードやサイズ帯の選択肢を増やしたいです。",
      a: "価格表の画面で区分を足すと、この画面の選択肢にも出てきます。",
    },
    {
      q: "乾燥の 12 時間も入れて大丈夫ですか。",
      a: "大丈夫です。乾燥のように人が張りつかない工程は、週の残り時間を減らさない扱いになっています。",
    },
    {
      q: "同じセットを別の対象にも使いたいです。",
      a: "今のところコピーはできません。新規作成でもう 1 つ作り、対象だけ変えてください。",
    },
  ],
  related: [
    { label: "カレンダー (作業予定)", href: "/help/calendar" },
    { label: "カレンダー — 作業種別", href: "/help/calendar-types" },
    { label: "カレンダー — 外部連携", href: "/help/calendar-connections" },
    { label: "価格表", href: "/admin/prices" },
    { label: "案件", href: "/help/deals" },
    { label: "見積書・請求書", href: "/help/documents" },
  ],
  glossary: [
    { term: "テンプレート", meaning: "よく使う工程と時間の組み合わせを、あらかじめ登録したものです。" },
    { term: "グレード", meaning: "仕上げの等級です。価格表で決めた区分を使います。" },
    { term: "サイズ帯", meaning: "品物の大きさの区分です。価格表で決めた区分を使います。" },
    { term: "明細", meaning: "セットの中身の 1 行です。工程と標準の時間の組です。" },
    { term: "(全対象)", meaning: "等級や大きさを問わず使う、という意味です。" },
  ],
};
