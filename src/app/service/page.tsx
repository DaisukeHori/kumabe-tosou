import type { Metadata } from "next";

import {
  ArrowButton,
  CtaBand,
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
    absolute: "サービス・料金 | 隈部塗装 — 工程・グレード・依頼の流れ",
  },
  description:
    "隈部塗装のサービスと料金。#800研磨→プラサフ→#1200水研ぎの共通下地に、下地仕上げ・スタンダード・プレミアム（3コートパール）の3グレード。数量スライド、依頼の流れ、正直な条件まで。",
  openGraph: {
    title: "サービス・料金 | 隈部塗装 — 工程・グレード・依頼の流れ",
    description:
      "#800研磨→プラサフ→#1200水研ぎの共通下地に、3グレード。数量スライド、依頼の流れ、正直な条件まで。",
  },
};

const PROCESS_ROWS = [
  {
    grit: "#800",
    step: "STEP 01 / SAND",
    title: "素地研磨",
    body: "積層痕を面で捉えて研ぎ落とします。FDMも光造形も、ここで平滑の土台を作ります。塗装の出来の大半は、この工程で決まります。",
  },
  {
    grit: "PS",
    step: "STEP 02 / PRIME",
    title: "プラサフ吹付",
    body: "プライマーサフェーサーを厚めに吹き、研磨で残った微細な段差を膜で埋めます。海外の3Dプリント仕上げでも、自動車用厚膜プラサフによる積層痕埋めは定番手法です。",
  },
  {
    grit: "#1200",
    step: "STEP 03 / WET-SAND",
    title: "水研ぎ仕上げ",
    body: "プロの板金塗装は #600〜800 で平滑化し、#1000〜1200 で仕上げます。一般的なDIY標準より1〜2段丁寧な、上塗りにとって十分以上の平滑面です。",
  },
  {
    grit: "2K",
    step: "STEP 04 / TOPCOAT",
    title: "上塗り",
    body: "ソリッド＋クリア、または3コートパール。市販の調色済み自動車補修塗料と2液ウレタンで、硬く艶やかに仕上げます。",
  },
  {
    grit: "CURE",
    step: "STEP 05 / 硬化・検品",
    title: "硬化・検品",
    body: "主剤と硬化剤の化学反応で常温硬化（表面乾燥1〜3時間、完全硬化5〜7日）。硬化を確認し、検品してから発送します。",
  },
] as const;

const FLOW_CELLS = [
  {
    title: "ご相談・お見積もり",
    body: "サイズ × 個数 × グレードの3点で概算をお出しします。",
  },
  {
    title: "造形物を工房へ発送",
    body: "データ入稿 → 提携出力 → 工房直送の流れにも対応します。",
  },
  {
    title: "受入検品・ビフォー撮影",
    body: "状態を記録してから工程に入ります。",
  },
  { title: "下地工程", body: "#800 研磨 → プラサフ → #1200 水研ぎ。" },
  {
    title: "上塗り",
    body: "グレード別に施工。火気厳禁・換気管理のもとで行います。",
  },
  {
    title: "硬化・アフター撮影",
    body: "常温または赤外線ヒーターで硬化。仕上がりを記録します。",
  },
  {
    title: "梱包・発送",
    body: "完全硬化前後の取り扱い注意点を添えてお届けします。",
  },
] as const;

const QC_ITEMS = [
  {
    title: "タレ・ダレ",
    en: "RUNS / SAGS",
    body: "塗料が流れて溜まった跡がないか。厚塗りを避け、薄く重ねることで防ぎます。",
  },
  {
    title: "ゆず肌",
    en: "ORANGE PEEL",
    body: "表面がミカンの皮のように凸凹していないか。吹き付けの距離と量で管理します。",
  },
  {
    title: "色ムラ",
    en: "COLOR CONSISTENCY",
    body: "光の当たり方を変えても、色が均一に見えるか。特にメタリック・パールで重要です。",
  },
  {
    title: "塗り残し",
    en: "COVERAGE",
    body: "エッジや奥まった箇所に、薄い部分・塗り残しがないか。角と縁を重点的に確認します。",
  },
  {
    title: "異物混入",
    en: "CONTAMINATION",
    body: "塗膜にホコリ・毛・ゴミが噛み込んでいないか。塗装環境の清浄度で防ぎます。",
  },
  {
    title: "密着",
    en: "ADHESION",
    body: "塗膜が素地にしっかり食いついているか。洗浄・脱脂・下地の徹底で担保します。",
  },
  {
    title: "エッジの被り",
    en: "EDGE QUALITY",
    body: "角・縁まで塗膜が回り込み、めくれや欠けがないか。輸送に耐える塗り際に整えます。",
  },
  {
    title: "硬化状態",
    en: "CURE",
    body: "2液ウレタンが完全硬化しているか。硬化を確認してから梱包・発送します。",
  },
] as const;

export default function ServicePage() {
  return (
    <>
      <PageHead
        index="INDEX 03 — SERVICE"
        en="PROCESS / GRADE / PRICE / FLOW"
        title={
          <>
            下地は全グレード共通。
            <br />
            だから品質が揺れない。
          </>
        }
        lead="自動車板金塗装のプロ標準工程を、そのまま3Dプリントに適用します。グレードの違いはトップコートの層数だけ。見積もりも「サイズ × 個数 × グレード」の3つで決まる、シンプルな構造です。"
      />

      {/* ============ 工程 ============ */}
      <Section>
        <SectionMark no="SEC. 01" label="PROCESS — 全メニュー共通の下地" />
        <div className="mt-10 divide-y divide-hair border-y border-hair">
          {PROCESS_ROWS.map((row) => (
            <div
              key={row.step}
              className="grid gap-3 py-6 sm:grid-cols-[140px_180px_minmax(0,1fr)] sm:gap-8"
            >
              <span className="font-mono text-2xl font-semibold tracking-[0.06em]">
                {row.grit}
                <small className="mt-1 block text-[10px] font-normal tracking-[0.18em] text-carbon-soft">
                  {row.step}
                </small>
              </span>
              <h3 className="text-lg font-bold tracking-wider">{row.title}</h3>
              <p className="text-sm leading-7 text-carbon-mid">{row.body}</p>
            </div>
          ))}
        </div>
        <aside className="mt-10 border-l-2 border-soul bg-paper p-6">
          <span className="font-mono text-[11px] tracking-[0.2em] text-soul">
            なぜ鏡面磨きをしないのか
          </span>
          <p className="mt-3 text-sm leading-7 text-carbon-mid">
            #2000〜コンパウンドの鏡面磨き工程は、あえて行いません。2液ウレタンは吹きっぱなしで自動車外板と同等の艶が出るためです。磨きに時間を使わないぶん、同じ品質で数量に応え、価格に還元します。
          </p>
        </aside>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.01"
            src="/img/spray-hold.jpg"
            alt="塗料を吹き付けるスプレーガン"
            capJa="吹き付けの工程"
            capEn="SPRAY APPLICATION"
            credit="Photo: createasea / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.02"
            src="/img/paint-cans.jpg"
            alt="調色済みの補修塗料"
            capJa="調色済みの補修塗料"
            capEn="AUTOMOTIVE PAINT"
            credit="Photo: jacobsoup / Unsplash"
          />
        </div>
        <div className="mt-10">
          <ArrowButton href="/process">全9工程を、層構造から見る</ArrowButton>
        </div>
      </Section>

      {/* ============ グレード ============ */}
      <Section>
        <SectionMark no="SEC. 02" label="GRADE — 差分はトップコートだけ" />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          <div className="border border-hair bg-paper p-6">
            <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
              GRADE 01
            </span>
            <h3 className="mt-3 text-xl font-bold tracking-wider">下地仕上げ</h3>
            <p className="mt-4 text-sm leading-7 text-carbon-mid">
              #800 研磨＋プラサフ＋#1200 仕上げで納品。塗装はしません。
            </p>
            <p className="mt-4 border-t border-hair-soft pt-4 text-[13px] leading-6 text-carbon-soft">
              最終色をご自身で吹く造形作家・ガレージキット層・試作会社の方へ。
            </p>
          </div>
          <div className="border border-hair bg-paper p-6">
            <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
              GRADE 02
            </span>
            <h3 className="mt-3 text-xl font-bold tracking-wider">スタンダード</h3>
            <p className="mt-4 text-sm leading-7 text-carbon-mid">
              下地＋ソリッドカラー＋2液ウレタンクリア。
            </p>
            <p className="mt-4 border-t border-hair-soft pt-4 text-[13px] leading-6 text-carbon-soft">
              単色の製品試作・小ロット生産品の外観仕上げに。
            </p>
          </div>
          <div className="border border-carbon bg-carbon p-6 text-paper">
            <span className="font-mono text-[10px] tracking-[0.2em] text-paper/60">
              GRADE 03
            </span>
            <h3 className="mt-3 text-xl font-bold tracking-wider">プレミアム</h3>
            <p className="mt-4 text-sm leading-7 text-paper/80">
              下地＋3コートパール（ベース＋パール＋クリア）。
            </p>
            <p className="mt-4 text-lg font-bold tracking-wider">
              ¥15,000–35,000 / 1点
              <small className="mt-1 block text-[11px] font-normal text-paper/60">
                目安。サイズにより変動します
              </small>
            </p>
            <p className="mt-4 border-t border-paper/20 pt-4 text-[13px] leading-6 text-paper/70">
              商談・展示会・クラウドファンディング掲載写真のための最上位仕上げ。
            </p>
          </div>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="border border-hair bg-paper p-6">
            <h4 className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              QUANTITY — 数量スライド（目安）
            </h4>
            <div className="mt-5 space-y-3">
              {[
                { label: "〜9個", w: "100%", val: "定価", best: false },
                { label: "10〜29個", w: "85%", val: "−15%", best: false },
                { label: "30個〜", w: "75%", val: "−25%", best: true },
              ].map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[5.5em_minmax(0,1fr)_4em] items-center gap-3"
                >
                  <span className="text-[13px] tracking-wider">{row.label}</span>
                  <span className="h-2 bg-hair-soft">
                    <span
                      className={`block h-full ${row.best ? "bg-soul" : "bg-carbon/60"}`}
                      style={{ width: row.w }}
                    />
                  </span>
                  <span className="text-right font-mono text-[12px]">
                    {row.val}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs leading-6 text-carbon-soft">
              同一品のバッチ仕上げ・カラーバリエーション展開に対応。初回のみ治具・段取り費をいただき、リピート時は免除します。繰り返すほど、双方に有利な構造です。
            </p>
          </div>
          <div className="border border-hair bg-paper p-6">
            <h4 className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              OPTIONS — 加算・個別対応
            </h4>
            <div className="mt-5 divide-y divide-hair-soft text-sm">
              <div className="flex items-baseline justify-between py-3">
                <span>特急仕上げ</span>
                <span className="font-mono">+50%</span>
              </div>
              <div className="flex items-baseline justify-between py-3">
                <span>大型・特殊案件</span>
                <span className="font-mono">個別見積もり</span>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-3">
                <span>色番号指定（日塗工・自動車カラーコード）</span>
                <span className="font-mono">対応</span>
              </div>
            </div>
            <p className="mt-5 text-xs leading-6 text-carbon-soft">
              価格は「サイズ帯別の基本料金＋グレード加算」で算出します。立ち上げ期につき実績価格でご提供中——正式価格表は作業実測に基づいて確定し、このページで公開します。
            </p>
          </div>
        </div>
        <div className="mt-10">
          <ArrowButton href="/shop#sim">
            SHOPのシミュレータで概算を出す
          </ArrowButton>
        </div>
      </Section>

      {/* ============ 依頼の流れ ============ */}
      <Section>
        <SectionMark no="SEC. 03" label="FLOW — 郵送で、全国から" />
        <SecTitle>依頼の流れ</SecTitle>
        <SecLead>
          主戦場は手のひら〜200×200mm級の小〜中型品。送料が軽微なサイズ帯なら、地方立地のハンデはありません。
        </SecLead>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW_CELLS.map((cell, i) => (
            <div key={cell.title} className="border border-hair bg-paper p-5">
              <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-[15px] font-bold tracking-wider">
                {cell.title}
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                {cell.body}
              </p>
            </div>
          ))}
        </div>
        <MapNote>
          ※
          進行中の写真は守秘義務の範囲で管理し、実績としての掲載は案件ごとに許諾をいただきます。NDA対応可。
        </MapNote>
      </Section>

      {/* ============ 正直な条件 ============ */}
      <Section>
        <SectionMark no="SEC. 04" label="HONEST TERMS" />
        <SecTitle>正直に、先にお伝えします。</SecTitle>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="border border-hair bg-paper p-6">
            <h3 className="text-lg font-bold tracking-wider">できること</h3>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-carbon-mid">
              {[
                "色番号指定（日塗工番号・自動車カラーコード）",
                "同一品のバッチ仕上げ・カラーバリエーション展開",
                "NDA対応・掲載許諾の案件ごと管理",
                "大型・特殊案件の個別見積もり",
                "未経験素材のテストピース確認",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden="true" className="text-carbon">
                    ○
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="border border-hair bg-paper p-6">
            <h3 className="text-lg font-bold tracking-wider">
              ご了承いただきたいこと
            </h3>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-carbon-mid">
              {[
                "純正色のピタリ合わせ（調色）は対象外です。市販の調色済み補修塗料による「参考色」仕上げです。",
                "2液ウレタンの完全硬化は5〜7日。発送は硬化を確認してからになります。",
                "経験のない樹脂素材は、テストピースでの相性確認を挟みます。",
                "繁忙期は「納期◯週間待ち」を表示して受注を絞ります。品質を落とさないためです。",
                "輸送中の破損に備え、梱包基準と保証条件を事前に明示します。",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden="true" className="text-soul">
                    —
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* ============ 品質管理 ============ */}
      <Section>
        <SectionMark no="SEC. 05" label="QUALITY CONTROL" />
        <SecTitle>発送前に、8つの目で見る。</SecTitle>
        <SecLead>
          自動車補修の現場で使われる検品項目を、そのまま持ち込んでいます。仕上がりは主観ではなく、チェックリストで確認してから梱包します。
        </SecLead>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QC_ITEMS.map((item) => (
            <div key={item.title} className="border border-hair bg-paper p-5">
              <span
                aria-hidden="true"
                className="inline-block size-3 border border-carbon/50"
              />
              <h4 className="mt-3 text-[15px] font-bold tracking-wider">
                {item.title}
                <span className="ml-2 font-mono text-[9px] font-normal tracking-[0.16em] text-carbon-soft">
                  {item.en}
                </span>
              </h4>
              <p className="mt-2 text-[13px] leading-6 text-carbon-mid">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark no="GALLERY" label="THE HANDS" />
        <SecTitle>工程の、その手。</SecTitle>
        <SecLead>
          工程の一つひとつに、自動車補修で培った手が入ります。
        </SecLead>
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.03"
            src="/img/sanding.jpg"
            alt="研磨の工程"
            capJa="研ぐ"
            capEn="SANDING"
            credit="Photo: mazinomron / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.04"
            src="/img/car-detail.jpg"
            alt="仕上がりの艶"
            capJa="仕上げる"
            capEn="THE FINISH"
            credit="Photo: avenir_visuals / Unsplash"
          />
        </div>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <>
            見積もりは、3つの数字で。
            <br />
            サイズ × 個数 × グレード。
          </>
        }
        note="造形データや写真があれば、より正確に概算をお出しできます。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
