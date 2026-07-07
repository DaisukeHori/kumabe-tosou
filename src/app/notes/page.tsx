import type { Metadata } from "next";

import {
  CtaBand,
  PageHead,
  PhotoFigure,
  Section,
} from "@/components/site/page-blocks";

export const metadata: Metadata = {
  title: {
    absolute: "読みもの | 隈部塗装 — 塗りと色の裏側",
  },
  description:
    "隈部塗装の読みもの。センチュリーの黒が水研ぎ3回である理由、ディーラーでも同色にならない赤の構造、R34の青に必要なもの、世界標準の理想像。工程と色の裏側を言葉で残します。",
  openGraph: {
    title: "読みもの | 隈部塗装 — 塗りと色の裏側",
    description:
      "センチュリーの黒が水研ぎ3回である理由、ディーラーでも同色にならない赤の構造。工程と色の裏側を言葉で残します。",
    images: ["/img/garage-work.jpg"],
  },
};

const TOC = [
  { id: "note-01", no: "NOTE 01", title: "黒の深さは、研ぎで決まる" },
  { id: "note-02", no: "NOTE 02", title: "ディーラーでも同色にならない赤" },
  { id: "note-03", no: "NOTE 03", title: "R34の青に必要なもの" },
  {
    id: "note-04",
    no: "NOTE 04",
    title: "「自動車表面のような艶」という世界標準",
  },
  {
    id: "note-05",
    no: "NOTE 05",
    title: "「射出成形品と見分けがつかない」の正体",
  },
  { id: "note-06", no: "NOTE 06", title: "2液ウレタンが、磨かずに光る理由" },
  {
    id: "note-07",
    no: "NOTE 07",
    title: "タイムズスクエアを、板金塗装で仕上げた話",
  },
] as const;

function Article({
  id,
  no,
  title,
  children,
}: {
  id: string;
  no: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article
      id={id}
      className="scroll-mt-24 border-t border-hair py-12 first:border-t-0"
    >
      <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
        {no}
      </span>
      <h2 className="mt-4 max-w-3xl text-[clamp(22px,2.8vw,32px)] font-bold leading-snug tracking-[0.04em]">
        {title}
      </h2>
      <div className="mt-7 max-w-3xl space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
        {children}
      </div>
    </article>
  );
}

export default function NotesPage() {
  return (
    <>
      <PageHead
        index="INDEX 08 — NOTES"
        en="READING ON PAINT & COLOR"
        title={
          <>
            なぜ綺麗なのかは、
            <br />
            写真だけでは伝わらない。
          </>
        }
        lead="工程と色の裏側を、言葉で残しています。専門性は、言語化してはじめて伝わる——それがこの工房の考え方です。"
      />

      {/* ============ 目次 ============ */}
      <Section className="py-8 sm:py-10">
        <nav
          aria-label="読みもの目次"
          className="border border-hair bg-paper p-6"
        >
          <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {TOC.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="flex items-baseline gap-3 text-sm tracking-wider text-carbon transition-colors hover:text-soul"
                >
                  <span className="shrink-0 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                    {item.no}
                  </span>
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Section>

      {/* ============ 記事 ============ */}
      <Section className="pt-4 sm:pt-6">
        <Article id="note-01" no="NOTE 01 — 下地の思想" title="黒の深さは、研ぎで決まる">
          <p>
            トヨタ・センチュリーの黒「神威（かむい）」は、塗装工程だけで約40時間をかけると言われます。その中身の象徴が、
            <strong>水研ぎ3回</strong>
            という数字です。レクサスの水研ぎが1回であることと比べれば、最高級の黒がどこに時間を注いでいるかがわかります。
          </p>
          <p>
            塗料を重ねれば黒くなるわけではありません。黒の「深さ」は、光がどれだけ乱れずに反射するかで決まり、それは塗面の下にある平滑さ——つまり研ぎの仕事で決まります。派手な上塗りではなく、見えなくなる下地こそが、最後の見た目を支配する。
          </p>
          <p>
            この工房が、#800の素地研磨からプラサフ、#1200の水研ぎまでを全グレード共通の核に置いているのは、同じ思想です。3Dプリントの積層痕も、原理は変わりません。
            <strong>縞を消すのは塗料ではなく、研ぎです。</strong>
          </p>
        </Article>

        <Article
          id="note-02"
          no="NOTE 02 — 色の構造"
          title="ディーラーでも同色にならない赤"
        >
          <p>
            マツダのソウルレッドクリスタルメタリック（46V）は、補修の世界で「ディーラーですら同色にならない」と言われてきた色です。理由は構造にあります。発色層に
            <strong>光を吸収するフレーク</strong>
            を含む3層構造で、塗り重ねの厚みと順序が、そのまま最終的な深みと鮮やかさを左右するのです。
          </p>
          <p>
            つまりこの赤は、缶の中の塗料の色ではなく、
            <strong>塗る人の経験が発色する色</strong>
            です。同じ塗料を使っても、膜厚の管理とフラッシュタイム（乾燥間隔）の取り方で、別の赤になります。
          </p>
          <p>
            当工房がこの色を色見本の一枚に選んでいるのは、それが理由です。塗れることが、そのまま技術の証明になる——見る人が見れば、一枚で伝わります。
          </p>
        </Article>

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.01"
            src="/img/garage-work.jpg"
            alt="ガレージで車体を仕上げる職人"
            capJa="下地に、誠実に。"
            capEn="HANDS AT WORK"
            credit="Photo: claritycoat / Unsplash"
            aspect="aspect-[21/9]"
            sizes="(max-width: 1240px) 100vw, 1240px"
          />
        </div>

        <Article id="note-03" no="NOTE 03 — 経験の色" title="R34の青に必要なもの">
          <p>
            日産スカイラインGT-R（R34）のベイサイドブルー（TV2）は、生産された車体のおよそ4分の1が纏ったと言われる、まさに代名詞の色です。そしてこの色の補修について、長く言われてきた言葉があります——
            <strong>「経験のある塗装工場を探すことが重要」</strong>。
          </p>
          <p>
            TV2も3コート構造です。下地の色、中間の青、その上のクリア。層の重なりで青の深さが決まるため、単純な色合わせでは同じ見え方になりません。名車の色が名車の色であり続けるには、それを再現できる手が要ります。
          </p>
          <p>
            この工房は、その「経験のある塗装工場」であることを、色見本で示すことにしました。写真の腕ではなく、塗りの腕で。
          </p>
        </Article>

        <Article
          id="note-04"
          no="NOTE 04 — 世界標準"
          title="「自動車表面のような艶」という世界標準"
        >
          <p>
            世界大手の3Dプリンタメーカーは、公式ガイドの中で3Dプリント仕上げの到達目標を
            <strong>「自動車表面のような艶と滑らかさ」</strong>
            と表現しています。さらに同社は、大型インスタレーションの制作で自動車板金塗装業者と協業し、各パーツにクリアコートを施工した事例も公開しています。
          </p>
          <p>
            つまり「3Dプリント ×
            自動車塗装職人」という組み合わせは、思いつきではなく、
            <strong>業界自身が掲げる理想像そのもの</strong>
            です。英語圏の仕上げコミュニティでも、自動車用の厚膜プラサフで積層痕を埋める手法は定番で、その到達点は「射出成形品のように見える」と語られます。
          </p>
          <p>
            その理想像を、本物の自動車塗装の手で、郵送で全国から受ける。隈部塗装は、その構図を大分から実装する工房です。
          </p>
        </Article>

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.02"
            src="/img/surface.jpg"
            alt="塗装面の微細な質感"
            capJa="面の平滑さが、光を素直に返す。"
            capEn="THE SURFACE"
            credit="Photo: apryan_cahyo / Unsplash"
            aspect="aspect-[21/9]"
            sizes="(max-width: 1240px) 100vw, 1240px"
          />
        </div>

        <Article
          id="note-05"
          no="NOTE 05 — 下地の到達点"
          title="「射出成形品と見分けがつかない」の正体"
        >
          <p>
            3Dプリントの仕上げについて、海外の専門ガイドには繰り返し登場する表現があります。
            <strong>
              「220番手から2000番手へ段階的に研磨し、自動車用プライマーを乗せた面は、射出成形されたABSと実質的に見分けがつかない」
            </strong>
            ——プレゼン用モデルやマスターパターンの世界で、到達点として語られる基準です。
          </p>
          <p>
            鍵は「段階研磨」にあります。いきなり細かい番手で磨いても、粗い傷は消えません。粗い番手で面を作り、少しずつ番手を上げて前の傷を消していく。この積み重ねだけが、光を素直に返す平滑面をつくります。当工房の{" "}
            <span className="font-mono">#800</span> → プラサフ →{" "}
            <span className="font-mono">#1200</span>{" "}
            という下地も、まさにこの思想の上にあります。
          </p>
          <p>
            「量産品と見分けがつかない外観に」——この工房が掲げる一文は、詩的な誇張ではありません。世界の現場が実際に到達している、具体的な技術の基準です。金型を使わずに、金型で成形したような顔をつくる。それが、下地の到達点です。
          </p>
        </Article>

        <Article
          id="note-06"
          no="NOTE 06 — 艶の科学"
          title="2液ウレタンが、磨かずに光る理由"
        >
          <p>
            模型塗装では、クリアを吹いた後にコンパウンドで鏡面磨きをするのが定番です。ところが自動車補修の世界では、
            <strong>2液ウレタンクリアは吹きっぱなしで深い艶が出ます</strong>
            。主剤と硬化剤が化学反応で結びつき、硬く平滑な塗膜そのものを形成するためです。海外の3Dプリンタメーカーも、仕上げには2液（2K）クリアを推奨しています。
          </p>
          <p>
            この違いは、そのまま価格と数量に効いてきます。1個ずつ時間をかけて磨く工程がないぶん、同じ品質を保ったまま数を仕上げられる。だから当工房は、あえて鏡面磨きをしません。磨きに使うはずだった時間を、数量対応と価格の還元に回しています。
          </p>
          <p>
            艶は、磨いて出すものだと思われがちです。けれど本当の艶は、塗料の化学と、その下の平滑な下地が生みます。
            <strong>
              磨かないのは、手を抜いているからではなく、そのほうが理にかなっているから。
            </strong>
          </p>
        </Article>

        <div className="py-8">
          <PhotoFigure
            figNo="FIG.03"
            src="/img/metal-work.jpg"
            alt="金属を加工する手元"
            capJa="素材に、手を変える。"
            capEn="CRAFTSMANSHIP"
            credit="Photo: riiyad / Unsplash"
            aspect="aspect-[21/9]"
            sizes="(max-width: 1240px) 100vw, 1240px"
          />
        </div>

        <Article
          id="note-07"
          no="NOTE 07 — 事例に学ぶ"
          title="タイムズスクエアを、板金塗装で仕上げた話"
        >
          <p>
            ニューヨークのタイムズスクエアに設置された、ある大型インスタレーション。世界大手の3Dプリンタメーカーがデザインチームと組んで制作したこの作品は、無数のタイルで構成されていました。そして、その各タイルのクリアコートを担ったのは——
            <strong>地元の自動車板金塗装店</strong>でした。
          </p>
          <p>
            大量のパーツに均一なクリアを吹き、屋外の環境に耐える塗膜をつくる。それは模型塗装の技術ではなく、毎日クルマを塗っている板金塗装の領域です。板金塗装店は、まず溶剤で表面を洗い、下地を整えてから、自動車用のクリアを施工したと記録されています。
          </p>
          <p>
            「3Dプリント ×
            自動車塗装」は、日本の片隅で思いついた奇策ではありません。
            <strong>世界の第一線が、すでに選んでいる組み合わせ</strong>
            です。隈部塗装は、その同じ構図を、大分から郵送で、全国のあなたの手元へ届けます。
          </p>
        </Article>

        <div className="mt-8 border border-hair bg-paper p-6">
          <p className="font-mono text-[10.5px] tracking-[0.22em] text-carbon-soft">
            COMING SOON
          </p>
          <p className="mt-3 text-sm leading-7 text-carbon-mid">
            今後、デモピースの製作記録や案件の実績（掲載許諾をいただいたもの）を、ここで発信していきます。
            <br />
            note・X・Instagram との連携も準備中です。
          </p>
        </div>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <>
            読んで気になったことは、
            <br />
            そのまま聞いてください。
          </>
        }
        note="工程・色・素材の相性、どんな質問でも。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
