import type { Metadata } from "next";

import {
  ArrowButton,
  MapNote,
  PageHead,
  PhotoFigure,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";

export const metadata: Metadata = {
  title: {
    absolute: "相談する | 隈部塗装 — 見積もりはサイズ×個数×グレードの3つで",
  },
  description:
    "隈部塗装へのご相談。見積もりは「サイズ×個数×グレード」の3点で概算をお出しできます。造形データや写真があればより正確に。正式な受付窓口は準備中です。",
  openGraph: {
    title: "相談する | 隈部塗装 — 見積もりはサイズ×個数×グレードの3つで",
    description:
      "見積もりは「サイズ×個数×グレード」の3点で概算をお出しできます。正式な受付窓口は準備中です。",
  },
};

const QUOTE_VARS = [
  {
    label: "SIZE",
    ja: "サイズ",
    body: "最長辺のおおよその寸法をお知らせください。主戦場は手のひら〜200×200mm級。大型は個別見積もり（送料実費）で対応します。",
  },
  {
    label: "QTY",
    ja: "個数",
    body: "1点から1,000個まで。同一品は10個以上で−15%、30個以上で−25%（目安）の数量スライドが効きます。",
  },
  {
    label: "GRADE",
    ja: "グレード",
    body: "下地仕上げ / スタンダード / プレミアム（3コートパール）の3択。迷ったら用途をお聞かせください。ご提案します。",
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "造形データだけでも頼めますか？",
    a: "はい。データ入稿 → 提携出力 → 工房直送の流れに対応しています。造形から仕上げまで一括でお受けできるため、「出力先と塗装先を別々に手配する」手間が省けます。造形方式（FDM / 光造形など）のご希望があればお知らせください。",
  },
  {
    q: "色は完全に純正色と同じにできますか？",
    a: "純正色のピタリ合わせ（調色）は対象外です。市販の調色済み補修塗料を正規の用途で使い、「参考色」として仕上げます。日塗工番号・自動車カラーコードでのご指定には対応します。8色ラインナップ以外の色もご相談ください。",
  },
  {
    q: "どのくらいの納期ですか？",
    a: "2液ウレタンの完全硬化に5〜7日かかり、硬化を確認してから発送します。工程日数を加えた目安は個別にお出しします。特急仕上げ（+50%）も可能です。繁忙期は品質維持のため「納期◯週間待ち」を表示して受注を絞ることがあります。",
  },
  {
    q: "初めての素材でも塗ってもらえますか？",
    a: "経験のない樹脂素材は、いきなり本番にはせず、テストピースで相性を確認してから進めます。塗料の食いつきや溶剤の影響を事前に見極めるためで、結果的に失敗のリスクを下げられます。",
  },
  {
    q: "秘密保持（NDA）に対応できますか？",
    a: "対応可能です。進行中の写真は守秘義務の範囲で管理し、実績としての掲載は案件ごとに許諾をいただいてからにしています。未発表製品の試作でも安心してお預けください。",
  },
] as const;

export default function ContactPage() {
  return (
    <>
      <PageHead
        index="INDEX 09 — CONTACT"
        en="SIZE × QTY × GRADE"
        title={
          <>
            見積もりは、
            <br />
            3つの数字で。
          </>
        }
        lead="「サイズ × 個数 × グレード」がわかれば、概算をお出しできます。下地が全グレード共通だから、見積もりの構造もこれだけシンプルです。造形データや写真、素材の種類がわかると、より正確になります。"
      />

      <Section className="pb-0 pt-6 sm:pb-0 sm:pt-8">
        <PhotoFigure
          figNo="FIG.00"
          src="/img/car-night.jpg"
          alt="夜に艶めく仕上がりの車体"
          capJa="あなたの「絶対に外せない一個」を、この艶に。"
          capEn="YOUR ONE PIECE, PERFECTED"
          credit="Photo: aaronburden / Unsplash"
          aspect="aspect-[21/9]"
          sizes="(max-width: 1240px) 100vw, 1240px"
        />
      </Section>

      {/* ============ 3変数 ============ */}
      <Section>
        <SectionMark no="SEC. 01" label="HOW TO ESTIMATE" />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {QUOTE_VARS.map((v) => (
            <div key={v.label} className="border border-hair bg-paper p-6">
              <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
                {v.label}
              </span>
              <p className="mt-2 text-xl font-bold tracking-wider">{v.ja}</p>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">{v.body}</p>
            </div>
          ))}
        </div>
        <MapNote>
          ※ あわせて伝えていただけると正確になる情報 — 造形方式（FDM /
          光造形など）、素材の種類、希望色（カラーコード可）、希望納期。未経験の素材はテストピース確認を挟みます。NDA対応可。
        </MapNote>
      </Section>

      {/* ============ 受付窓口 ============ */}
      <Section>
        <SectionMark no="SEC. 02" label="CONTACT" />
        <div className="mt-10 border border-hair bg-paper p-8 sm:p-10">
          <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
            STATUS — PREPARING
          </span>
          <p className="mt-5 text-[15px] leading-[2.1] text-carbon-mid">
            正式な受付窓口（出品ページ・お問い合わせフォーム）は現在準備中です。
            <br />
            開設までの先行のご相談は、ご紹介経由で承っています。
            <br />
            窓口が整い次第、このページでご案内します。
          </p>
        </div>
      </Section>

      {/* ============ 逆リンク ============ */}
      <Section>
        <SectionMark no="SEC. 03" label="BEFORE YOU ASK" />
        <SecTitle>ご相談の前に。</SecTitle>
        <SecLead>
          工程・グレード・数量スライドの詳細はサービスページに、対応色の考え方は色見本ページにまとめています。「できないこと」も先に書いています——正直さも品質のうちです。
        </SecLead>
        <div className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/service">サービス・料金</ArrowButton>
          <ArrowButton href="/colors">色見本</ArrowButton>
        </div>
      </Section>

      {/* ============ FAQ ============ */}
      <Section>
        <SectionMark no="SEC. 04" label="FAQ" />
        <SecTitle>よくあるご質問</SecTitle>
        <div className="mt-10 divide-y divide-hair border-y border-hair">
          {FAQ_ITEMS.map((item, i) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-baseline gap-4 py-5 text-[15px] font-medium tracking-wider [&::-webkit-details-marker]:hidden">
                <span className="shrink-0 font-mono text-[11px] tracking-[0.16em] text-carbon-soft">
                  Q.{String(i + 1).padStart(2, "0")}
                </span>
                {item.q}
                <span
                  aria-hidden="true"
                  className="ml-auto shrink-0 text-carbon-soft transition-transform group-open:rotate-45"
                >
                  ＋
                </span>
              </summary>
              <p className="pb-6 pl-[3.4em] pr-4 text-sm leading-7 text-carbon-mid">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </Section>
    </>
  );
}
