import { Badge } from "@/components/ui/badge";
import {
  CtaBand,
  MapNote,
  PageHead,
  PhotoFigure,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import type { ResolvedSlots } from "@/modules/page-media/contracts";

const METHODS = [
  {
    tag: "METHOD 01",
    title: "FDM / FFF方式",
    en: "FUSED DEPOSITION MODELING",
    desc: "熱で溶かした樹脂を層状に積み上げる方式。3方式の中で積層痕が最も目立ち、研磨とサーフェイサーによる下地づくりが仕上がりを大きく左右します。",
    diff: (
      <>
        <strong className="font-bold text-carbon">この工房での位置づけ</strong>{" "}
        — 最も下地に手がかかる＝研磨の技術が最も活きる素材。
        <span className="font-mono">#800</span>{" "}
        で面出しし、厚膜プラサフで積層痕を埋め、
        <span className="font-mono">#1200</span> で仕上げます。
      </>
    ),
  },
  {
    tag: "METHOD 02",
    title: "光造形方式（レジン）",
    en: "SLA / MSLA / DLP",
    desc: "液体樹脂を光で硬化させる方式。もともと積層痕が少なく滑らかですが、未硬化レジンの洗浄と二次硬化を済ませないと塗料が乗りません。レジンはアクリル系で、塗料との相性は良好です。",
    diff: (
      <>
        <strong className="font-bold text-carbon">この工房での位置づけ</strong>{" "}
        —
        洗浄・脱脂・二次硬化の状態を確認してから工程へ。滑らかなぶん下地は軽く、意匠塗装の美しさが素直に出ます。
      </>
    ),
  },
  {
    tag: "METHOD 03",
    title: "SLS方式（粉末）",
    en: "SELECTIVE LASER SINTERING",
    desc: "ナイロン粉末をレーザーで焼結する方式。表面は多孔質で、ビーズブラストで均一化するのが一般的。塗装には粉末特有の下地づくりが必要です。",
    diff: (
      <>
        <strong className="font-bold text-carbon">この工房での位置づけ</strong>{" "}
        —
        要相談・テストピース確認を推奨。多孔質を活かした下地で、艶を作り込みます。
      </>
    ),
  },
] as const;

const MATERIALS: {
  name: string;
  sub?: string;
  method: string;
  point: string;
  weather: string;
  uv: boolean;
}[] = [
  {
    name: "PLA",
    sub: "ポリ乳酸",
    method: "FDM",
    point:
      "アセトンは効かないため、研磨とスプレーパテで物理的に平滑化。サーフェイサーで密着を確保します。",
    weather: "屋内向き",
    uv: false,
  },
  {
    name: "PETG",
    method: "FDM",
    point: "研磨・サーフェイサー・塗装が基本。密着のため脱脂を丁寧に行います。",
    weather: "UV安定",
    uv: true,
  },
  {
    name: "ABS",
    method: "FDM",
    point:
      "研磨に加え、アセトン蒸気処理で光沢化する手もあります。塗装前は必ず脱脂。",
    weather: "屋内向き",
    uv: false,
  },
  {
    name: "ASA",
    method: "FDM",
    point:
      "ABSに近い扱い。屋外用途に向く素材で、クリアのUVカットと相性良好です。",
    weather: "UV安定",
    uv: true,
  },
  {
    name: "標準レジン",
    sub: "アクリル系",
    method: "光造形",
    point:
      "IPA洗浄とUV二次硬化を前提に。滑らかで下地は軽く、意匠塗装が映えます。黄変対策のクリアを推奨。",
    weather: "屋内向き",
    uv: false,
  },
  {
    name: "タフレジン",
    sub: "ABSライク",
    method: "光造形",
    point:
      "靭性が高く、割れにくい。標準レジン同様の下地で、扱いやすい素材です。",
    weather: "屋内向き",
    uv: false,
  },
  {
    name: "クリアレジン",
    method: "光造形",
    point:
      "段階研磨とクリアコートで透明感を出せます。透過部を活かした意匠にも対応。",
    weather: "屋内向き",
    uv: false,
  },
  {
    name: "ナイロン",
    sub: "PA12 / PA11",
    method: "SLS",
    point:
      "多孔質のため下地を作り込む。ブラスト後の均一な面に艶を重ねます。要テスト。",
    weather: "UV安定",
    uv: true,
  },
];

const CAUSES = [
  {
    no: "CAUSE 01",
    title: "洗浄・脱脂の不足",
    body: "造形物に残った離型剤・削りカス・指の脂は、塗料の密着を著しく下げます。研磨後に水洗いし、イソプロピルアルコールで脱脂、タッククロスで微粉を除いてから塗装に入ります。光造形品は未硬化レジンの洗浄も欠かせません。",
  },
  {
    no: "CAUSE 02",
    title: "サーフェイサーの省略",
    body: "下地のサーフェイサー（プラサフ）を省くと、密着も発色も落ちます。厚膜タイプで微細な段差を埋め、塗料が乗る土台をつくる——この一手間を飛ばさないことが、量産品のような均一な面につながります。",
  },
  {
    no: "CAUSE 03",
    title: "厚塗りによる細部の潰れ",
    body: "一度に厚く吹くと、タレ・ゆず肌が出て、細かな造形ディテールも埋まります。塗る方向を層ごとに変えながら、薄く数回に分けて重ねる——地味ですが、これが仕上がりの質を決めます。",
  },
] as const;

export function MaterialsPageBody({
  slots,
  editMode,
}: {
  slots: ResolvedSlots;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead
        index="INDEX 06 — MATERIALS"
        en="FDM / SLA / SLS"
        title={
          <>
            素材を選ばない。
            <br />
            ただし、素材ごとに手を変える。
          </>
        }
        lead="3Dプリントは、造形方式によって積層痕の出方も、塗料の乗り方も、まったく違います。FDMは研磨で埋め、光造形は洗浄と二次硬化を前提にし、SLSは多孔質を作り込む——同じ「下地」でも、素材ごとに手を変えます。ここでは対応方式と、素材別の考え方をまとめます。"
      />

      {/* ============ 3方式 ============ */}
      <Section>
        <SectionMark no="SEC. 01" label="PRINTING METHODS" />
        <SecTitle>
          3つの造形方式、
          <br />
          それぞれの下地。
        </SecTitle>
        <Reveal as="div" className="mt-10 grid gap-5 md:grid-cols-3">
          {METHODS.map((method) => (
            <div key={method.tag} className="border border-hair bg-paper p-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-soul">
                {method.tag}
              </p>
              <h3 className="mt-3 text-lg font-bold tracking-wider">
                {method.title}
              </h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-carbon-soft">
                {method.en}
              </p>
              <p className="mt-4 text-sm leading-7 text-carbon-mid">
                {method.desc}
              </p>
              <p className="mt-4 border-t border-hair-soft pt-4 text-[13px] leading-6 text-carbon-mid">
                {method.diff}
              </p>
            </div>
          ))}
        </Reveal>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.01"
            slotKey="materials.methods.1"
            resolved={slots["materials.methods.1"]}
            editMode={editMode}
            capJa="FDMの造形"
            capEn="FDM PRINTING"
            credit="Photo: zmorph3d / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.02"
            slotKey="materials.methods.2"
            resolved={slots["materials.methods.2"]}
            editMode={editMode}
            capJa="精密な造形機械"
            capEn="PRECISION MACHINE"
            credit="Photo: kadircelep / Unsplash"
          />
        </Reveal>
      </Section>

      {/* ============ 素材別対応表 ============ */}
      <Section>
        <SectionMark no="SEC. 02" label="MATERIAL MATRIX" />
        <SecTitle>素材別の、対応と勘所。</SecTitle>
        <SecLead>
          代表的な樹脂ごとの下地処理・注意点・耐候性の目安です。ここに無い素材も、テストピースで相性を確認してからお受けできます。
        </SecLead>
        <Reveal as="div" className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[720px] border-t border-hair text-sm">
            <thead>
              <tr className="border-b border-hair text-left font-mono text-[10px] tracking-[0.18em] text-carbon-soft">
                <th scope="col" className="py-3 pr-4 font-normal">
                  素材
                </th>
                <th scope="col" className="py-3 pr-4 font-normal">
                  造形方式
                </th>
                <th scope="col" className="py-3 pr-4 font-normal">
                  下地の勘所
                </th>
                <th scope="col" className="py-3 font-normal">
                  耐候性の目安
                </th>
              </tr>
            </thead>
            <tbody>
              {MATERIALS.map((mat) => (
                <tr key={mat.name} className="border-b border-hair align-top">
                  <th
                    scope="row"
                    className="py-4 pr-4 text-left font-bold tracking-wider"
                  >
                    {mat.name}
                    {mat.sub ? (
                      <small className="block text-[11px] font-normal text-carbon-soft">
                        {mat.sub}
                      </small>
                    ) : null}
                  </th>
                  <td className="py-4 pr-4 text-carbon-mid">{mat.method}</td>
                  <td className="py-4 pr-4 leading-6 text-carbon-mid">
                    {mat.point}
                  </td>
                  <td className="py-4">
                    <Badge
                      variant="outline"
                      className={`rounded-none font-mono text-[10px] tracking-[0.1em] ${
                        mat.uv
                          ? "border-soul/50 text-soul"
                          : "border-hair text-carbon-mid"
                      }`}
                    >
                      {mat.weather}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
        <MapNote>
          ※
          耐候性は一般的な目安です。標準レジンは紫外線で黄変・脆化が進むため、屋外長期使用には向きません。撮影・展示・商談用の高品質仕上げとしての運用を前提にしています。屋外で長く使う想定がある場合は、素材段階からご相談ください。
        </MapNote>
      </Section>

      {/* ============ 下地の作り分け ============ */}
      <Section>
        <SectionMark no="SEC. 03" label="WHY IT MATTERS" />
        <SecTitle>
          失敗の多くは、
          <br />
          塗る前に決まっている。
        </SecTitle>
        <SecLead>
          塗料の食いつき不良やムラは、塗装技術以前の「素地の準備」で起きることがほとんどです。だから、この工房は塗る前の工程に最も神経を使います。
        </SecLead>
        <Reveal as="div" className="kt-timeline mt-10">
          {CAUSES.map((cause) => (
            <div key={cause.no} className="kt-timeline-item">
              <span className="font-mono text-[10.5px] tracking-[0.14em] text-soul">
                {cause.no}
              </span>
              <h4 className="mt-2 text-[17px] font-bold tracking-[0.04em]">
                {cause.title}
              </h4>
              <p className="mt-2 max-w-[44em] text-[13.5px] leading-[1.95] text-carbon-mid">
                {cause.body}
              </p>
            </div>
          ))}
        </Reveal>
      </Section>

      {/* ============ 入稿 ============ */}
      <Section>
        <SectionMark no="SEC. 04" label="DATA INTAKE" />
        <SecTitle>造形から、任せてもいい。</SecTitle>
        <SecLead>
          完成した造形物を送っていただくのはもちろん、データ入稿 → 提携出力 →
          工房直送の流れにも対応します。出力先と塗装先を別々に手配する手間を省けます。
        </SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <div className="border border-hair bg-paper p-6">
            <p className="font-mono text-2xl font-semibold tracking-[0.08em]">
              STL
              <small className="ml-3 text-[11px] font-normal tracking-[0.14em] text-carbon-soft">
                汎用フォーマット
              </small>
            </p>
            <p className="mt-4 text-sm leading-7 text-carbon-mid">
              ほぼすべての3Dプリント環境で扱える標準形式。造形するだけなら、これで十分です。メッシュ（三角形の集合）でモデルを表現します。
            </p>
          </div>
          <div className="border border-hair bg-paper p-6">
            <p className="font-mono text-2xl font-semibold tracking-[0.08em]">
              STEP
              <small className="ml-3 text-[11px] font-normal tracking-[0.14em] text-carbon-soft">
                精密フォーマット
              </small>
            </p>
            <p className="mt-4 text-sm leading-7 text-carbon-mid">
              正確な形状を保持する形式（ISO
              10303）。寸法精度が重要な場合や、任意の解像度で再メッシュしたい場合に向きます。精密案件ではこちらを推奨します。
            </p>
          </div>
        </Reveal>
        <MapNote>
          ※
          ご相談時に、造形方式・素材・希望色（カラーコード可）・希望納期をあわせてお知らせいただけると、概算が正確になります。未発表製品はNDA対応可。
        </MapNote>
      </Section>

      {/* ============ GALLERY ============ */}
      <Section>
        <SectionMark no="GALLERY" label="BEYOND MATERIAL" />
        <SecTitle>素材の、その先。</SecTitle>
        <SecLead>素材ごとに手を変える。それが下地づくりの本質です。</SecLead>
        <Reveal as="div" className="mt-10 grid gap-5 sm:grid-cols-2">
          <PhotoFigure
            figNo="FIG.03"
            slotKey="materials.gallery.1"
            resolved={slots["materials.gallery.1"]}
            editMode={editMode}
            capJa="質感"
            capEn="TEXTURE"
            credit="Photo: apryan_cahyo / Unsplash"
          />
          <PhotoFigure
            figNo="FIG.04"
            slotKey="materials.gallery.2"
            resolved={slots["materials.gallery.2"]}
            editMode={editMode}
            capJa="仕上がり"
            capEn="THE FINISH"
            credit="Photo: avenir_visuals / Unsplash"
          />
        </Reveal>
      </Section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <>
            素材が決まっていなくても、
            <br />
            用途から相談できます。
          </>
        }
        note="「屋外で使う」「撮影用」「触れる展示物」——用途に合う素材と仕上げをご提案します。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
