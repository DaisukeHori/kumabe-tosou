import { CtaBand, PageHead, PhotoFigure } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotImage } from "@/components/site/slot-image";
import { SlotText } from "@/components/site/slot-text";
import type { ResolvedSlots, ResolvedTexts } from "@/modules/page-media/contracts";

function Chapter({
  no,
  title,
  en,
  children,
  photo,
}: {
  no: string;
  title: React.ReactNode;
  en: string;
  children: React.ReactNode;
  photo: React.ReactNode;
}) {
  return (
    <section className="kt-story-chapter">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid items-start gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] md:gap-14">
          <Reveal as="div" className="kt-story-head">
            <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
              {no}
            </span>
            <h2 className="mt-4 text-[clamp(24px,3.2vw,38px)] font-bold leading-snug tracking-[0.04em]">
              {title}
            </h2>
            <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-carbon-soft">
              {en}
            </p>
          </Reveal>
          <Reveal
            as="div"
            className="kt-story-body space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon"
          >
            {children}
          </Reveal>
        </div>
        <div className="mt-10">{photo}</div>
      </div>
    </section>
  );
}

function StoryQuote({ children }: { children: React.ReactNode }) {
  return <p className="kt-story-quote">{children}</p>;
}

/**
 * story.portrait (未来枠) の装飾プレースホルダ。V2a 以前 (旧 page.tsx) の見た目を
 * SlotImage の placeholder prop 経由で復元したもの (公開時の非退行、修正1)。
 * 自己完結で aspect-[3/4] / aria-label を持つため、editMode=false のときは
 * SlotImage が余計なラッパを足さずそのまま描画する。
 * 枠線・斜めストライプ背景・四隅コーナーマークは呼び出し側の `.kt-portrait-frame` /
 * `.kt-portrait-corner` (motion: page-story-process) が担うため、本体は背景を持たず
 * 透過のまま重ねる (ストライプが透けて見える)。
 */
export function StoryPortraitPlaceholder() {
  return (
    <figure
      className="relative flex aspect-[3/4] w-full flex-col items-center justify-center"
      aria-label="代表・隈部信之（近日、実際の写真に差し替え予定）"
    >
      <span className="text-4xl font-bold tracking-[0.2em]">信之</span>
      <span className="mt-6 font-mono text-[10px] tracking-[0.24em] text-carbon-soft">
        PORTRAIT — COMING SOON
      </span>
    </figure>
  );
}

export function StoryPageBody({
  slots,
  texts,
  editMode,
}: {
  slots: ResolvedSlots;
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead
        index="INDEX 01 — STORY"
        en="WHY THIS WORKSHOP EXISTS"
        title={
          <SlotText
            slotKey="story.hero.heading"
            resolved={texts["story.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="story.hero.lead"
            resolved={texts["story.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      {/* ============ 第一章 ============ */}
      <Chapter
        no="CHAPTER 01"
        title={
          <>
            毎日、同じ色を、
            <br />
            同じ艶で。
          </>
        }
        en="The Ordinary Days"
        photo={
          <PhotoFigure
            figNo="FIG.01"
            slotKey="story.chapter.1"
            resolved={slots["story.chapter.1"]}
            editMode={editMode}
            capJa="均一に、正確に。それが量産塗装の日常だった。"
            capEn="THE DISCIPLINE"
            credit="Photo: cmreflections / Unsplash"
          />
        }
      >
        <p>
          隈部塗装を始める前、隈部信之の一日は、色に始まり、色に終わっていました。持ち場は、家電の量産塗装。工場のラインを流れてくる筐体に、決められた色を、決められた膜厚で、来る日も来る日も吹き付ける。一個目と一万個目が、寸分違わぬ艶であること。それが、その仕事に求められる唯一のことでした。
        </p>
        <p>
          派手さはありません。誰かに褒められる仕事でもない。塗り上がった製品は、当たり前の顔をして箱に詰められ、家電量販店の棚に並び、誰かの家のリビングに置かれる。その表面が均一で美しいことに、気づく人はいません。
          <strong>気づかれないことこそが、量産塗装の完成形</strong>だからです。
        </p>
        <p>
          けれど、毎日同じ色を塗り続けるうちに、体は覚えていきました。塗料がどう流れ、どう乾き、どの距離でどう乗るのか。均一な膜をつくる手つき。段取りの組み方。治具の使い方。それは、一点ものを美しく塗る技術とは、まったく別の筋肉でした。
          <strong>「同じ品質で、数を仕上げる」——量産の精度</strong>
          が、いつのまにか体に染み込んでいたのです。
        </p>
      </Chapter>

      {/* ============ 第二章 ============ */}
      <Chapter
        no="CHAPTER 02"
        title={
          <>
            その造形物には、
            <br />
            縞があった。
          </>
        }
        en="The Call"
        photo={
          <PhotoFigure
            figNo="FIG.02 — THE GAP"
            slotKey="story.chapter.2"
            resolved={slots["story.chapter.2"]}
            editMode={editMode}
            capJa="造形はできる。だが、その先の仕上げに空白があった。"
            capEn="AWAITING ITS FINISH"
            credit="Photo: claritycoat / Unsplash"
          />
        }
      >
        <p>
          きっかけは、知人からの一本の相談でした。手のひらにのる、樹脂の造形物。3Dプリンターで出力したという、ある製品の試作。手に取ると、表面にうっすらと横縞が走っていました。層を積み重ねてつくる、3Dプリント特有の跡——積層痕です。
        </p>
        <p>
          「これ、量産品みたいに綺麗に塗れませんか」。知人は言いました。そして、続けた言葉が、隈部の胸に刺さりました。
        </p>
        <StoryQuote>
          「塗装をやってくれる店はあるんです。でも、この積層痕を分かってる人がいない。造形はできても、仕上げは単色止まり。誰も、最後の一歩をやってくれないんですよ」
          <cite>— ある試作の相談者の言葉</cite>
        </StoryQuote>
        <p>
          その瞬間、隈部は気づきました。塗装はできても3Dプリントの下地を知らない塗装店。造形はできても仕上げは苦手な出力サービス。その二つの
          <strong>あいだにぽっかり空いた空白</strong>
          ——そこに必要なものは、自分が毎日やっていることそのものだ、と。均一に、正確に、数を美しく塗る。量産塗装の精度こそが、この新しい世界に決定的に欠けているものでした。
        </p>
      </Chapter>

      {/* ============ 第三章 ============ */}
      <Chapter
        no="CHAPTER 03"
        title={
          <>
            樹脂は、
            <br />
            鉄板とは違った。
          </>
        }
        en="The Trials"
        photo={
          <PhotoFigure
            figNo="FIG.03"
            slotKey="story.chapter.3"
            resolved={slots["story.chapter.3"]}
            editMode={editMode}
            capJa="研いでは吹き、吹いては削る。"
            capEn="TRIAL & ERROR"
            credit="Photo: mazinomron / Unsplash"
          />
        }
      >
        <p>
          思い立ってすぐ、うまくいったわけではありません。自動車の鉄板と、3Dプリントの樹脂は、まるで別物でした。素材ごとに塗料の食いつきが違う。溶剤に弱いものもある。そして何より——
          <strong>積層痕は、塗料をいくら重ねても消えない</strong>
          。厚く吹けば、細かな造形ディテールが埋まってしまう。塗るほどに、縞は醜く浮かび上がることさえありました。
        </p>
        <p>
          テストピースを、何枚も塗りました。研いでは吹き、吹いては削り。失敗した造形物が、作業台の隅に積み上がっていきました。洗浄が甘ければ塗料が弾き、脱脂を怠ればムラが出る。3Dプリントの塗装には、模型とも、クルマとも違う、独自の勘所があったのです。
        </p>
        <p>
          それでも、手を動かし続けました。なぜなら、あの言葉が忘れられなかったから。「誰も、最後の一歩をやってくれない」。ならば、自分がやる。試行錯誤の日々は、地味で、報われるかも分からないものでした。けれど職人は、うまくいかない理由を一つずつ潰していくことを、苦だとは思わないのです。
        </p>
      </Chapter>

      {/* ============ 第四章 ============ */}
      <Chapter
        no="CHAPTER 04"
        title={
          <>
            答えは、毎日やっていた
            <br />
            下地にあった。
          </>
        }
        en="The Revelation"
        photo={
          <PhotoFigure
            figNo="FIG.04"
            slotKey="story.chapter.4"
            resolved={slots["story.chapter.4"]}
            editMode={editMode}
            capJa="量産品と、見分けがつかない。"
            capEn="INDISTINGUISHABLE"
            credit="Photo: avenir_visuals / Unsplash"
          />
        }
      >
        <p>
          転機は、ある一枚のテストピースでした。積層痕を{" "}
          <span className="font-mono">#800</span>{" "}
          の紙やすりで面ごと研ぎ落とし、プラサフを厚めに吹いて微細な段差を埋め、
          <span className="font-mono">#1200</span>{" "}
          で水研ぎをかける。それは、自動車補修の現場で当たり前にやっている、ごく
          basic
          な下地の作り方でした。その上に塗料を乗せたとき——縞は、跡形もなく消えていました。
        </p>
        <p>
          答えは、遠くにはありませんでした。
          <strong>毎日やっていた「下地」の中に、ずっとあった</strong>
          のです。塗装の出来の大半は、塗る前の下地で決まる。自動車塗装が何十年もかけて磨いてきたこの原則は、そのまま3Dプリントの積層痕にも効いた。縞を消すのは、塗料ではなく、研ぎだったのです。
        </p>
        <StoryQuote>
          量産品と、見分けがつかない。
          <br />
          金型を使わずに、金型で成形したような顔をつくる。
        </StoryQuote>
        <p>
          試作の一個も、量産の千個も、同じ品質で。それは、一点を美しく塗る技術と、数を均一に仕上げる技術——その両方を持つ、
          <strong>量産塗装職人にしかできない仕事</strong>
          でした。あの空白に、ぴたりと嵌まる形が、ようやく見つかった瞬間でした。
        </p>
      </Chapter>

      {/* ============ 第五章 ============ */}
      <Chapter
        no="CHAPTER 05"
        title={
          <>
            大分から、
            <br />
            あなたの一個へ。
          </>
        }
        en="The Return"
        photo={
          <PhotoFigure
            figNo="FIG.05"
            slotKey="story.chapter.5"
            resolved={slots["story.chapter.5"]}
            editMode={editMode}
            capJa="大分から、あなたの一個へ。"
            capEn="THE BEGINNING"
            credit="Photo: aaronburden / Unsplash"
          />
        }
      >
        <p>
          こうして、隈部塗装は始まりました。大分県豊後高田市の、小さな工房。乗用車のバンパーを6本同時に塗れるブースで、あなたの造形物を、量産品の顔に仕上げます。手のひらサイズの小物なら、郵送の送料はごくわずか。地方の工房であることは、もうハンデではありません。
        </p>
        <p>
          企業トップへの最終プレゼン。展示会。クラウドファンディングの一枚の写真。あるいは、金型を作らない少量生産の、初回ロット。
          <strong>「絶対に外せない一個」</strong>
          が、世の中にはたくさんあります。その一個を、量産品と見分けがつかない外観に仕上げること。それが、この工房の仕事です。
        </p>
        <p>
          本当のことを言えば、この物語がどこまで劇的だったかは、大した問題ではありません。大切なのは、いま目の前にある造形物を、どこまで美しく仕上げられるか。その一点だけです。
          <strong>下地に、誠実に。</strong>——それが、隈部塗装のすべてです。
        </p>
      </Chapter>

      {/* ============ 代表メッセージ ============ */}
      <section className="kt-message-sec">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] md:gap-14">
          <Reveal as="div" className="max-w-sm">
            <div className="kt-portrait-frame">
              <SlotImage
                slotKey="story.portrait"
                resolved={slots["story.portrait"]}
                editMode={editMode}
                className="bg-transparent"
                placeholder={<StoryPortraitPlaceholder />}
              />
              <span
                className="kt-portrait-corner kt-portrait-corner--tl"
                aria-hidden="true"
              >
                +
              </span>
              <span
                className="kt-portrait-corner kt-portrait-corner--br"
                aria-hidden="true"
              >
                +
              </span>
            </div>
          </Reveal>
          <div>
            <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
              MESSAGE — 代表挨拶
            </span>
            <SlotText
              as="h2"
              className="mt-5 text-[clamp(24px,3.2vw,38px)] font-bold leading-snug tracking-[0.04em]"
              slotKey="story.message.heading"
              resolved={texts["story.message.heading"]}
              editMode={editMode}
            />
            <div className="mt-8 space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
              <p>
                私は、塗装職人です。長く家電の量産塗装に携わり、来る日も来る日も、同じ色を同じ艶で塗ってきました。その中で身についたのは、「同じ品質で、数を仕上げる」という、量産の精度です。
              </p>
              <p>
                3Dプリントの世界に足を踏み入れて分かったのは、この技術を必要としている人が、たしかにいるということでした。造形はできる。でも、量産品のように美しく仕上げる最後の一歩で、みんなが困っている。だったら、私がやろう。そう思って、この工房を始めました。
              </p>
              <p>
                塗装の出来は、塗る前の下地で決まります。研磨し、埋め、また研ぐ。仕上がった塗面には、その苦労は一切見えません。
                <strong>見えなくなるからこそ、そこに手を抜かない。</strong>
                それが職人の矜持だと思っています。
              </p>
              <p>
                あなたの大切な造形物を、量産品と見分けがつかない外観に。その一個に、私の持てる技術のすべてを注ぎます。どうぞ、安心してお預けください。
              </p>
            </div>
            <div className="mt-10 flex items-baseline gap-4 border-t border-hair pt-6">
              <span className="text-xs tracking-wider text-carbon-soft">
                隈部塗装 代表 / 塗装職人
              </span>
              <span className="text-xl font-bold tracking-[0.14em]">
                隈部 信之
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <CtaBand
        title={
          <SlotText
            slotKey="story.cta.heading"
            resolved={texts["story.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="story.cta.note"
            resolved={texts["story.cta.note"]}
            editMode={editMode}
          />
        }
        href="/contact"
        label="相談する"
      />
    </>
  );
}
