import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  CtaBand,
  PageHead,
  PhotoFigure,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { ServiceSimLink } from "@/components/site/service-sim-link";
import { ShopSimulator } from "@/components/site/shop-simulator";

export const metadata: Metadata = {
  title: {
    absolute: "SHOP | 隈部塗装 — 仕上げを、通販のように買う",
  },
  description:
    "隈部塗装のSHOP。3Dプリント表面処理の受託サービス（下地仕上げ・スタンダード・プレミアム）を、サイズ×個数×グレードのシミュレータで概算し、そのまま注文相談へ。塗装済み製品の販売枠も。",
  openGraph: {
    title: "SHOP | 隈部塗装 — 仕上げを、通販のように買う",
    description:
      "受託サービスをサイズ×個数×グレードのシミュレータで概算し、そのまま注文相談へ。塗装済み製品の販売枠も。",
    images: ["/img/black-car.jpg"],
  },
};

const DD = {
  "090": { a: "var(--dd-090-a)", b: "var(--dd-090-b)" },
  "46v": { a: "var(--dd-46v-a)", b: "var(--dd-46v-b)" },
  "4y6": { a: "var(--dd-4y6-a)", b: "var(--dd-4y6-b)" },
  "3t4": { a: "var(--dd-3t4-a)", b: "var(--dd-3t4-b)" },
  "202": { a: "var(--dd-202-a)", b: "var(--dd-202-b)" },
  tv2: { a: "var(--dd-tv2-a)", b: "var(--dd-tv2-b)" },
  am: { a: "var(--dd-am-a)", b: "var(--dd-am-b)" },
  "46g": { a: "var(--dd-46g-a)", b: "var(--dd-46g-b)" },
} as const;

const SWATCH_TITLES: Record<keyof typeof DD, string> = {
  "090": "プレシャスホワイトパール",
  "46v": "ソウルレッドクリスタル",
  "4y6": "プレシャスブロンズ",
  "3t4": "ピンクサファイア",
  "202": "ブラック",
  tv2: "ベイサイドブルー",
  am: "アストンマーティングリーン",
  "46g": "マシーングレー",
};

function MiniSwatch({ id }: { id: keyof typeof DD }) {
  return (
    <span
      title={SWATCH_TITLES[id]}
      className="inline-block size-6 border border-hair"
      style={{
        background: `linear-gradient(135deg, ${DD[id].a}, ${DD[id].b})`,
      }}
    />
  );
}

function SvcBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-hair bg-primer px-2.5 py-1 text-[11px] tracking-wider text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
      {children}
    </span>
  );
}

const BUY_FLOW = [
  {
    no: "STEP 01",
    title: "注文・相談",
    body: "上のシミュレータで概算を出し、内容をコピーして相談ページからご連絡ください。造形データ（STL/STEP）や写真、素材の種類が分かると、より正確なお見積もりになります。",
    meta: (
      <>
        必要なもの —{" "}
        <strong className="font-bold text-carbon">
          造形物 or データ・希望グレード・色
        </strong>
      </>
    ),
  },
  {
    no: "STEP 02",
    title: "正式見積もり・お支払い",
    body: "形状・素材・色を確認し、正式なお見積もりを提示します。ご了承いただいてから、お支払い（銀行振込・前払い）。未発表製品にはNDAで対応します。",
    meta: (
      <>
        支払い —{" "}
        <strong className="font-bold text-carbon">
          銀行振込（カード決済は準備中）
        </strong>
      </>
    ),
  },
  {
    no: "STEP 03",
    title: "発送 → 施工",
    body: "造形物を工房へお送りください。受入検品とビフォー撮影ののち、研磨・脱脂・プラサフ・足付け・塗装まで、全9工程で仕上げます。未経験素材はテストピースで確認してから。",
    meta: (
      <>
        記録 —{" "}
        <strong className="font-bold text-carbon">
          ビフォー／アフターを撮影
        </strong>
      </>
    ),
  },
  {
    no: "STEP 04",
    title: "硬化・検品 → お届け",
    body: "2液ウレタンの完全硬化（5〜7日）を待ち、ブツ・タレ・肌・艶など8項目の検品を通してから、丁寧に梱包して返送します。生乾きで送ることはしません。",
    meta: (
      <>
        品質 —{" "}
        <strong className="font-bold text-carbon">完全硬化＋8項目検品</strong>
      </>
    ),
  },
] as const;

export default function ShopPage() {
  return (
    <>
      <PageHead
        index="INDEX 09 — SHOP"
        en="ORDER FINISHING ONLINE"
        title={
          <>
            仕上げを、
            <br />
            通販のように買う。
          </>
        }
        lead="受託の表面仕上げを、商品のように選べるようにしました。グレードを選び、サイズと個数で概算を出し、そのまま注文のご相談へ。オンライン決済は現在準備中のため、いまは「注文の意思表示 → 相談 → 正式見積もり → お支払い」の流れでお受けしています。手のひらの造形物を送るだけで、量産品の顔になって還ってきます。"
      />

      <Section className="pb-0 pt-6 sm:pb-0 sm:pt-8">
        <PhotoFigure
          figNo="FIG.00 — WHAT YOU BUY"
          src="/img/black-car.jpg"
          alt="深い艶で仕上げられた黒い車体"
          capJa="あなたが手にするのは、この深さ。自動車グレードの艶を、造形物に。"
          capEn="AUTOMOTIVE-GRADE FINISH, DELIVERED"
          credit="Photo: cmreflections / Unsplash"
          aspect="aspect-[21/9]"
          sizes="(max-width: 1240px) 100vw, 1240px"
        />
      </Section>

      {/* ============ SEC.01 サービスを買う ============ */}
      <Section>
        <SectionMark no="SEC. 01" label="FINISHING SERVICES — 受託仕上げ" />
        <SecTitle>
          3つのグレードから、
          <br />
          選ぶ。
        </SecTitle>
        <SecLead>
          下地はどのグレードも共通です。<span className="font-mono">#800</span>{" "}
          で積層痕を研ぎ落とし、プラサフで微細な段差を埋め、
          <span className="font-mono">#1200</span>{" "}
          で水研ぎ。違いはトップコートの層数だけ——塗らずに下地で仕上げるか、ソリッド1色か、パール3層か。あなたの造形物を工房へ送るだけで、射出成形品と見分けのつかない外観になって還ります。
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 lg:grid-cols-3">
          {/* GRADE 01 */}
          <div className="flex flex-col border border-hair bg-paper">
            <figure className="relative">
              <span className="absolute left-3 top-3 z-10 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                GRADE 01
              </span>
              <div className="relative aspect-[3/2] w-full overflow-hidden">
                <Image
                  src="/img/sanding.jpg"
                  alt="研磨で下地を整える工程"
                  fill
                  sizes="(max-width: 1024px) 100vw, 400px"
                  className="object-cover"
                />
              </div>
            </figure>
            <div className="flex flex-1 flex-col p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                SERVICE 01
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-wider">
                下地仕上げ
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                PRIMER-READY FINISH
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SvcBadge>
                  研磨 <strong>#800</strong>
                </SvcBadge>
                <SvcBadge>
                  水研ぎ <strong>#1200</strong>
                </SvcBadge>
                <SvcBadge>
                  塗装 <strong>なし</strong>
                </SvcBadge>
              </div>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                積層痕を消し、プラサフまで入れた「塗る直前」の状態で納品します。縞は跡形もなく消え、面はなめらか。ここから先の色は、あなたの手に委ねます。塗装費が乗らないぶん、最も手に取りやすいグレードです。
              </p>
              <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                含まれる工程
              </p>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-6 text-carbon-mid">
                <li>・#800 による積層痕の面研ぎ</li>
                <li>・プラサフ（下塗り・中塗り）で段差を充填</li>
                <li>・#1200 水研ぎで塗装可能面に</li>
              </ul>
              <div className="mt-4 border-t border-hair-soft pt-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  こんな方に
                </p>
                <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                  最終色をご自身で吹く造形作家・ガレージキット層・試作会社。「下地だけ、プロにやってほしい」という方へ。
                </p>
              </div>
              <p className="mt-5 text-2xl font-bold tracking-wider">
                ¥7,000〜{" "}
                <small className="text-[11px] font-normal text-carbon-soft">
                  1点あたり / サイズ別目安・税込
                </small>
              </p>
              <ServiceSimLink
                grade="base"
                className="mt-5 flex items-center justify-center gap-1 border border-carbon/40 py-3 text-sm tracking-[0.08em] transition-colors hover:bg-carbon hover:text-paper"
              >
                サイズと個数で概算
                <span aria-hidden="true">→</span>
              </ServiceSimLink>
            </div>
          </div>

          {/* GRADE 02 */}
          <div className="flex flex-col border border-hair bg-paper">
            <figure className="relative">
              <span className="absolute left-3 top-3 z-10 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                GRADE 02
              </span>
              <div className="relative aspect-[3/2] w-full overflow-hidden">
                <Image
                  src="/img/spray-hold.jpg"
                  alt="ソリッドカラーを吹き付ける工程"
                  fill
                  sizes="(max-width: 1024px) 100vw, 400px"
                  className="object-cover"
                />
              </div>
            </figure>
            <div className="flex flex-1 flex-col p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                SERVICE 02
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-wider">
                スタンダード
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                SOLID COLOR + 2K CLEAR
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SvcBadge>共通下地</SvcBadge>
                <SvcBadge>
                  コート <strong>2層</strong>
                </SvcBadge>
                <SvcBadge>2液ウレタン</SvcBadge>
              </div>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                共通下地の上に、ソリッドカラーのベースコートと2液ウレタンクリアを重ねます。吹きっぱなしで自動車外板と同等の艶が出るため、磨き工程は不要。単色の製品試作・小ロット生産品の外観仕上げに、過不足のないグレードです。
              </p>
              <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                含まれる工程
              </p>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-6 text-carbon-mid">
                <li>・共通下地（研磨〜水研ぎ）一式</li>
                <li>・ソリッドカラー ベースコート</li>
                <li>・2液ウレタンクリア（常温硬化）</li>
              </ul>
              <div className="mt-4 border-t border-hair-soft pt-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  こんな方に
                </p>
                <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                  単色でいい製品試作・小ロット生産品。「量産品のような、均一な単色の艶」が欲しい方へ。
                </p>
              </div>
              <p className="mt-5 text-2xl font-bold tracking-wider">
                ¥10,000〜{" "}
                <small className="text-[11px] font-normal text-carbon-soft">
                  1点あたり / サイズ別目安・税込
                </small>
              </p>
              <ServiceSimLink
                grade="standard"
                className="mt-5 flex items-center justify-center gap-1 border border-carbon/40 py-3 text-sm tracking-[0.08em] transition-colors hover:bg-carbon hover:text-paper"
              >
                サイズと個数で概算
                <span aria-hidden="true">→</span>
              </ServiceSimLink>
            </div>
          </div>

          {/* GRADE 03 */}
          <div className="flex flex-col border-2 border-carbon bg-paper">
            <figure className="relative">
              <span className="absolute left-3 top-3 z-10 bg-soul px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                GRADE 03 — 最上位
              </span>
              <div className="relative aspect-[3/2] w-full overflow-hidden">
                <Image
                  src="/img/car-night.jpg"
                  alt="パールが夜に艶めく車体"
                  fill
                  sizes="(max-width: 1024px) 100vw, 400px"
                  className="object-cover"
                />
              </div>
            </figure>
            <div className="flex flex-1 flex-col p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-soul">
                SERVICE 03 — 最上位
              </p>
              <h3 className="mt-2 text-xl font-bold tracking-wider">
                プレミアム
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                3-COAT PEARL
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <SvcBadge>共通下地</SvcBadge>
                <SvcBadge>
                  コート <strong>3層</strong>
                </SvcBadge>
                <SvcBadge>
                  参考色 <strong>8色</strong>
                </SvcBadge>
              </div>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                ベース＋パール＋クリアの3コート。角度で表情を変える、名車の象徴色そのものの深みです。「絶対に外せない一個」——商談・展示会・クラウドファンディングの一枚のための、最上位仕上げ。下記の8色から選べます。
              </p>
              <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                選べる参考色（8色）
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(Object.keys(DD) as (keyof typeof DD)[]).map((id) => (
                  <MiniSwatch key={id} id={id} />
                ))}
              </div>
              <div className="mt-4 border-t border-hair-soft pt-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                  こんな方に
                </p>
                <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                  商談・展示会・クラファン掲載の勝負試作。「写真で一目で伝わる、最高の質感」が要る方へ。
                </p>
              </div>
              <p className="mt-5 text-2xl font-bold tracking-wider">
                ¥15,000–35,000{" "}
                <small className="text-[11px] font-normal text-carbon-soft">
                  1点あたり / 目安・税込
                </small>
              </p>
              <ServiceSimLink
                grade="premium"
                className="mt-5 flex items-center justify-center gap-1 bg-carbon py-3 text-sm tracking-[0.08em] text-paper transition-colors hover:bg-carbon/85"
              >
                サイズと個数で概算
                <span aria-hidden="true">→</span>
              </ServiceSimLink>
            </div>
          </div>
        </Reveal>
        <p className="mt-6 text-xs leading-6 text-carbon-soft">
          ※
          価格は「サイズ帯別の基本料金＋グレード」で決まる立ち上げ期の目安です。上記は最小サイズ（〜100mm）からの参考価格で、サイズが上がると変動します。正式価格表は作業実測に基づいて確定し、このページを更新します。色番号指定（日塗工・自動車カラーコード）にも対応。
          <Link href="/colors" className="text-soul underline">
            8色の色見本を一枚ずつ見る
          </Link>
          ／
          <Link href="/service" className="text-soul underline">
            工程と品質管理の詳細
          </Link>
          。
        </p>
      </Section>

      {/* ============ SEC.02 見積もりシミュレータ ============ */}
      <Section id="sim" className="scroll-mt-20">
        <SectionMark no="SEC. 02" label="ESTIMATE SIMULATOR" />
        <SecTitle>
          サイズ × 個数 × グレード。
          <br />
          3つ選べば、概算が出る。
        </SecTitle>
        <SecLead>
          数量スライド（10個以上 −15% / 30個以上
          −25%）と特急（＋50%）も反映した概算レンジを、その場で計算します。面を埋めるほど1個あたりの手間は下がる——だから、数を出すほど有利になります。内容はワンタップでコピーして、そのまま相談に貼り付けられます。
        </SecLead>
        <Reveal as="div" className="mt-10">
          <ShopSimulator />
        </Reveal>
      </Section>

      {/* ============ SEC.03 塗装済み製品 ============ */}
      <Section>
        <SectionMark no="SEC. 03" label="READY-MADE — 塗装済み製品" />
        <SecTitle>
          手に取れる製品も、
          <br />
          ここに並びます。
        </SecTitle>
        <SecLead>
          工房で仕上げた「そのまま買える」製品の販売枠です。第一弾として、画面では絶対に伝わらない粒子感・深みを手元で確かめられる、実物の色見本パネルを準備しています。掲載製品は順次追加していきます。
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-3">
          {/* 8色セット */}
          <article className="flex flex-col border border-hair bg-paper">
            <div className="relative flex aspect-[3/2] flex-col items-center justify-center gap-4 bg-primer-deep">
              <span className="absolute left-3 top-3 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                COMING SOON
              </span>
              <div className="flex flex-wrap justify-center gap-2 px-8">
                {(Object.keys(DD) as (keyof typeof DD)[]).map((id) => (
                  <span
                    key={id}
                    className="inline-block size-9 border border-hair"
                    style={{
                      background: `linear-gradient(135deg, ${DD[id].a}, ${DD[id].b})`,
                    }}
                  />
                ))}
              </div>
              <span className="font-mono text-[9px] tracking-[0.18em] text-carbon-soft">
                8-COLOR SET — IMAGE
              </span>
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-lg font-bold tracking-wider">
                六角色見本パネル・8色セット
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                HEX-SET-08
              </p>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                8色の参考色を、実物の塗り板で。画面では絶対に伝わらない、パールの粒子感と深みを手元で確認できるセットです。制作検討の色決めに。
              </p>
              <ul className="mt-4 space-y-2 border-t border-hair-soft pt-4 text-[13px]">
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">形状</span>
                  <span className="text-right text-carbon-mid">
                    対辺70mm 六角形 × 8枚
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">仕様</span>
                  <span className="text-right text-carbon-mid">
                    裏面にカラーコード刻印
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">用途</span>
                  <span className="text-right text-carbon-mid">
                    色決め・貸出プラン準備中
                  </span>
                </li>
              </ul>
              <p className="mt-auto pt-5 text-xl font-bold tracking-wider">
                価格未定
                <small className="ml-2 text-[11px] font-normal text-carbon-soft">
                  準備中
                </small>
              </p>
            </div>
          </article>

          {/* 単色 */}
          <article className="flex flex-col border border-hair bg-paper">
            <div className="relative flex aspect-[3/2] flex-col items-center justify-center gap-4 bg-primer-deep">
              <span className="absolute left-3 top-3 bg-carbon px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                COMING SOON
              </span>
              <span
                className="inline-block size-24 border border-hair"
                style={{
                  background: `linear-gradient(135deg, ${DD.tv2.a}, ${DD.tv2.b})`,
                }}
              />
              <span className="font-mono text-[9px] tracking-[0.18em] text-carbon-soft">
                SINGLE PANEL — IMAGE
              </span>
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-lg font-bold tracking-wider">
                六角色見本パネル・単色
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                HEX-01
              </p>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                気になる1色だけを手元に。ソウルレッド、ベイサイドブルー、ホワイトパールなど、8色から選べる単品パネル。まずは狙いの色を、実物で確かめてください。
              </p>
              <ul className="mt-4 space-y-2 border-t border-hair-soft pt-4 text-[13px]">
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">形状</span>
                  <span className="text-right text-carbon-mid">
                    対辺70mm 六角形 × 1枚
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">選択</span>
                  <span className="text-right text-carbon-mid">
                    8色から1色を指定
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">仕様</span>
                  <span className="text-right text-carbon-mid">
                    裏面にカラーコード刻印
                  </span>
                </li>
              </ul>
              <p className="mt-auto pt-5 text-xl font-bold tracking-wider">
                価格未定
                <small className="ml-2 text-[11px] font-normal text-carbon-soft">
                  準備中
                </small>
              </p>
            </div>
          </article>

          {/* 受注制作 */}
          <article className="flex flex-col border border-hair bg-paper">
            <div className="relative flex aspect-[3/2] flex-col items-center justify-center gap-4 bg-primer-deep">
              <span className="absolute left-3 top-3 bg-soul px-2 py-1 font-mono text-[9px] tracking-[0.16em] text-paper">
                受注制作
              </span>
              <span
                className="inline-block size-24 border border-hair"
                style={{
                  background: `linear-gradient(135deg, ${DD["202"].a}, ${DD["202"].b})`,
                }}
              />
              <span className="font-mono text-[9px] tracking-[0.18em] text-carbon-soft">
                YOUR OBJECT HERE
              </span>
            </div>
            <div className="flex flex-1 flex-col p-6">
              <h3 className="text-lg font-bold tracking-wider">
                あなたの造形物・一点仕上げ
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                CUSTOM-01
              </p>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                この枠の主役は、あなたの造形物です。上のシミュレータで概算を出して、そのままご相談ください。仕上がった実例は、許可をいただいた上でここに並びます。
              </p>
              <ul className="mt-4 space-y-2 border-t border-hair-soft pt-4 text-[13px]">
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">対応</span>
                  <span className="text-right text-carbon-mid">
                    郵送受託・全国対応
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">数量</span>
                  <span className="text-right text-carbon-mid">
                    1点〜1,000個
                  </span>
                </li>
                <li className="flex justify-between gap-4">
                  <span className="text-carbon-soft">グレード</span>
                  <span className="text-right text-carbon-mid">
                    下地／スタンダード／プレミアム
                  </span>
                </li>
              </ul>
              <p className="mt-auto pt-5 text-xl font-bold tracking-wider">
                ¥7,000〜
                <small className="ml-2 text-[11px] font-normal text-carbon-soft">
                  シミュレータで概算
                </small>
              </p>
            </div>
          </article>
        </Reveal>
        <p className="mt-6 text-xs leading-6 text-carbon-soft">
          ※
          製品ビジュアルは現在イメージ（塗り板の色をCSSで再現したもの）です。実物の写真・価格・在庫は、販売開始時にこのページで公開します。
        </p>
      </Section>

      {/* ============ SEC.04 購入の流れ ============ */}
      <Section>
        <SectionMark no="SEC. 04" label="HOW TO ORDER" />
        <SecTitle>注文から、お届けまで。</SecTitle>
        <SecLead>
          遠く離れた工房でも、安心して預けられるように。受入から発送まで、記録を残しながら進めます。オンライン決済が整うまでは、下記のとおり相談ベースでお受けしています。
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BUY_FLOW.map((cell) => (
            <div key={cell.no} className="border border-hair bg-paper p-5">
              <span className="font-mono text-[10px] tracking-[0.2em] text-soul">
                {cell.no}
              </span>
              <h4 className="mt-2 text-[15px] font-bold tracking-wider">
                {cell.title}
              </h4>
              <p className="mt-3 text-[13px] leading-6 text-carbon-mid">
                {cell.body}
              </p>
              <p className="mt-3 border-t border-hair-soft pt-3 text-[12px] leading-5 text-carbon-soft">
                {cell.meta}
              </p>
            </div>
          ))}
        </Reveal>
        <p className="mt-6 text-xs leading-6 text-carbon-soft">
          お支払い方法・時期、送料、返品条件などの取引条件は
          <Link href="/tokushoho" className="text-soul underline">
            特定商取引法に基づく表記
          </Link>
          を、よくある質問は
          <Link href="/contact" className="text-soul underline">
            相談ページのFAQ
          </Link>
          をご確認ください。オンライン決済（クレジットカード）は現在準備中で、対応開始時に各商品の「購入」ボタンが有効になります。
        </p>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <>
            概算が出たら、
            <br />
            あとは送るだけ。
          </>
        }
        note="シミュレータの内容をコピーして、そのまま貼り付けてご相談ください。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
