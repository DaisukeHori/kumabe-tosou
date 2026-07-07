import type { Metadata } from "next";

import {
  CtaBand,
  MapNote,
  PageHead,
  PhotoFigure,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
  SpecTable,
} from "@/components/site/page-blocks";

export const metadata: Metadata = {
  title: {
    absolute: "会社案内 | 隈部塗装 — 3Dプリント表面処理の専門工房",
  },
  description:
    "隈部塗装の会社案内。代表・隈部信之のプロフィール、工房設備、会社概要、所在地（大分県豊後高田市）。家電量産塗装で培った精度を、3Dプリントの表面処理に注ぐ自動車塗装職人の工房です。",
  openGraph: {
    title: "会社案内 | 隈部塗装 — 3Dプリント表面処理の専門工房",
    description:
      "代表・隈部信之のプロフィール、工房設備、会社概要、所在地（大分県豊後高田市）。",
    images: ["/img/airbrush-dark.jpg"],
  },
};

export default function AboutPage() {
  return (
    <>
      <PageHead
        index="INDEX 02 — ABOUT"
        en="WORKSHOP & CRAFTSMAN"
        title={
          <>
            下地の仕事は、
            <br />
            見えなくなるからこそ。
          </>
        }
        lead="仕上がった塗面に、研ぎの跡は残りません。それでも、艶の深さも、色の正確さも、すべては見えなくなった下地が決めています。隈部塗装は、その見えない工程に最も時間を割く工房です。"
      />

      {/* ============ 市場の空白 ============ */}
      <Section>
        <SectionMark no="SEC. 01" label="WHY THIS WORKSHOP" />
        <SecTitle>
          「表面処理だけ頼みたい」に、
          <br />
          応える工房が少なかった。
        </SecTitle>
        <div className="mt-10">
          <SpecTable
            rows={[
              {
                th: "大手3Dプリント業者",
                td: "塗装は後加工オプション扱いで、多くは黒塗装・単色止まり。カスタム塗装は手動見積もりで、3コートパール等の高難度意匠塗装は稀。",
              },
              {
                th: "一般の塗装店",
                td: "塗装はできても、3Dプリント特有の積層痕処理を知らない。素材との相性や下地の作り方に、専用のノウハウが要ります。",
              },
              {
                th: "試作会社",
                td: "デザインモデルの品質は表面処理で決まるにもかかわらず、表面処理を高水準で内製できる会社は少なく、「表面処理だけ外注したい」需要が存在します。",
              },
              {
                th: "隈部塗装",
                td: (
                  <>
                    <strong className="font-bold text-carbon">
                      積層痕を消す研磨・自動車グレードの艶・3コートパールの意匠。3つ全部をひとりで持ち、その空白に正確に嵌まります。
                    </strong>
                    海外では、顧客の試作品の仕上げ・塗装だけを専門に請け負うサービスが成立しており、世界大手の3Dプリンタメーカーも自動車塗装業者との協業事例を公開しています。「3Dプリント
                    ×
                    自動車塗装職人」は、業界の理想像そのものです。
                  </>
                ),
              },
            ]}
          />
        </div>
      </Section>

      {/* ============ 代表 ============ */}
      <Section>
        <SectionMark no="SEC. 02" label="CRAFTSMAN" />
        <div className="mt-10 grid gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:gap-14">
          <div>
            <p className="text-[clamp(28px,4vw,44px)] font-bold tracking-[0.1em]">
              隈部 信之
            </p>
            <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              KUMABE NOBUYUKI — REPRESENTATIVE / PAINTER
            </p>
          </div>
          <div className="space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid">
            <p>
              家電の量産塗装の現場で、均一な膜厚管理・治具化・段取りを積み重ねてきた自動車塗装職人。「量産の精度」を体に入れ、いまはその技術のすべてを、3Dプリントの表面処理に注いでいます。
            </p>
            <p>
              一点ものを美しく塗ることと、同じ品質で数を仕上げることは、別の技術です。量産塗装の現場は、後者を毎日要求します。だから、あなたの一点の勝負試作と、千個のブリッジ生産を、同じ品質基準で仕上げられます。
            </p>
          </div>
        </div>
      </Section>

      {/* ============ 設備 ============ */}
      <Section>
        <SectionMark no="SEC. 03" label="FACILITY" />
        <SecTitle>バンパー6本を、同時に塗れる。</SecTitle>
        <SecLead>
          同時処理能力は、そのまま数量対応力と価格に反映されます。面を埋めるほど1個あたりの手間は下がる——バッチ処理は、この工房の価格競争力の源泉です。
        </SecLead>
        <div className="mt-10">
          <SpecTable
            rows={[
              {
                th: "塗装ブース",
                td: (
                  <>
                    乗用車のバンパー
                    <strong className="font-bold text-carbon">6本</strong>
                    を同時に塗装できる常設ブース。
                  </>
                ),
              },
              {
                th: "バッチ処理能力",
                td: (
                  <>
                    <strong className="font-bold text-carbon">
                      200×200mm級 — 約30個
                    </strong>{" "}
                    /{" "}
                    <strong className="font-bold text-carbon">
                      30×200mm級 — 100個超
                    </strong>{" "}
                    を同時処理。
                  </>
                ),
              },
              {
                th: "塗料システム",
                td: "自動車補修用2液ウレタン（主剤＋硬化剤の化学反応で常温硬化）。市販の調色済み補修塗料を正規用途で使用。",
              },
              {
                th: "硬化",
                td: "常温硬化（表面乾燥1〜3時間 / 完全硬化5〜7日）。赤外線ヒーターは納期短縮・回転率向上の道具として小〜中型に併用。",
              },
              {
                th: "安全管理",
                td: "塗装作業中（溶剤蒸気がある間）の火気は厳禁。石油燃焼機器の使用は、塗装後に換気を経てからの雰囲気加熱に限定しています。",
              },
            ]}
          />
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          <PhotoFigure
            figNo="FIG.01"
            src="/img/airbrush-dark.jpg"
            alt="暗い作業台に置かれたスプレーガン"
            capJa="吹き付けの設備"
            capEn="SPRAY EQUIPMENT"
            credit="Photo: kagan_4854 / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.02"
            src="/img/tools-rack.jpg"
            alt="工房の壁に整然と並ぶ工具"
            capJa="整然と並ぶ工具"
            capEn="THE TOOLING"
            credit="Photo: volft / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.03"
            src="/img/machine.jpg"
            alt="工房の産業機械"
            capJa="工房の機械"
            capEn="THE MACHINERY"
            credit="Photo: kadircelep / Unsplash"
          />
        </div>
      </Section>

      {/* ============ 会社概要 ============ */}
      <Section>
        <SectionMark no="SEC. 04" label="PROFILE" />
        <SecTitle>会社概要</SecTitle>
        <div className="mt-10">
          <SpecTable
            rows={[
              { th: "屋号", td: "隈部塗装（くまべとそう）" },
              { th: "代表", td: "隈部 信之" },
              { th: "所在地", td: "大分県豊後高田市" },
              {
                th: "事業内容",
                td: "3Dプリント造形物の表面処理（研磨・塗装）／家電の量産塗装",
              },
              {
                th: "対応エリア",
                td: "全国（郵送受託）。主戦場は手のひら〜200×200mm級の小〜中型品。",
              },
              {
                th: "受付窓口",
                td: "準備中（先行のご相談は紹介経由で承っています）",
              },
            ]}
          />
        </div>
      </Section>

      {/* ============ 地図 ============ */}
      <Section>
        <SectionMark no="SEC. 05" label="LOCATION" />
        <SecTitle>大分県豊後高田市</SecTitle>
        <SecLead>
          郵送受託が基本のため、地方立地のハンデはありません。送料が軽微な小〜中型品なら、全国どこからでも同じ条件でお受けできます。
        </SecLead>
        <div className="mt-10 border border-hair bg-paper p-2">
          <iframe
            src="https://maps.google.com/maps?q=%E5%A4%A7%E5%88%86%E7%9C%8C%E8%B1%8A%E5%BE%8C%E9%AB%98%E7%94%B0%E5%B8%82&t=m&z=10&output=embed"
            title="隈部塗装の所在地（大分県豊後高田市）"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="block aspect-[21/9] w-full border-0"
          />
        </div>
        <MapNote>
          ※ 工房の詳細な住所は、ご依頼確定時に発送先としてご案内します。
        </MapNote>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark no="GALLERY" label="THE PLACE" />
        <SecTitle>現場の、手ざわり。</SecTitle>
        <SecLead>
          大分・豊後高田の工房で、造形物と一個ずつ向き合っています。
        </SecLead>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.04"
            src="/img/metal-work.jpg"
            alt="金属を加工する手元"
            capJa="手の仕事"
            capEn="CRAFTSMANSHIP"
            credit="Photo: riiyad / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.05"
            src="/img/surface.jpg"
            alt="塗装面の微細な質感"
            capJa="面の質感"
            capEn="THE SURFACE"
            credit="Photo: apryan_cahyo / Unsplash"
          />
        </div>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <>
            工程と料金の詳細は、
            <br />
            サービスページに。
          </>
        }
        note="下地は全グレード共通。差分はトップコートの層数だけです。"
        href="/service"
        label="サービス・料金を見る"
      />
    </>
  );
}
