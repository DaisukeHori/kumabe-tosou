import type { HelpAnnotation, HelpScreenshot } from "../types";

/**
 * スクリーンショット + 注釈オーバーレイ。
 *
 * 注釈の座標は「元画像のピクセル」で渡ってくる。ここで SVG の viewBox に
 * そのまま流し込み、SVG 自体を画像に重ねて 100% 幅で描くため、
 * 表示サイズが変わっても (ウィンドウを狭める / 印刷する) 位置がずれない。
 * 線の太さだけは vector-effect で拡大縮小の影響を受けないようにしている。
 */
const ANNOTATION_COLOR = "#d33";
const BADGE_RADIUS = 11; // 直径 22px の赤丸 (設計書 §4)

export function AnnotatedScreenshot({ shot }: { shot: HelpScreenshot }) {
  const markerId = `help-arrow-${hashId(shot.src)}`;
  return (
    <figure className="my-4 flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-lg border border-border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- public/ 配下の固定画像。最適化不要で、注釈 SVG と 1:1 に重ねる必要がある */}
        <img
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          className="block h-auto w-full"
        />
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${shot.width} ${shot.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          data-help-overlay=""
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={ANNOTATION_COLOR} />
            </marker>
          </defs>
          {shot.annotations.map((annotation, index) => (
            <AnnotationShape key={index} annotation={annotation} markerId={markerId} />
          ))}
        </svg>
      </div>
      {shot.caption ? (
        <figcaption className="text-xs text-muted-foreground">{shot.caption}</figcaption>
      ) : null}
    </figure>
  );
}

function AnnotationShape({ annotation, markerId }: { annotation: HelpAnnotation; markerId: string }) {
  if (annotation.kind === "box") {
    return (
      <g>
        <rect
          x={annotation.x}
          y={annotation.y}
          width={annotation.w}
          height={annotation.h}
          rx={6}
          fill="none"
          stroke={ANNOTATION_COLOR}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        />
        {annotation.number !== undefined ? (
          <NumberBadge x={annotation.x} y={annotation.y} number={annotation.number} />
        ) : null}
        {annotation.label ? (
          <text
            x={annotation.x}
            y={annotation.y - BADGE_RADIUS - 6}
            fill={ANNOTATION_COLOR}
            fontSize={14}
            fontWeight="bold"
          >
            {annotation.label}
          </text>
        ) : null}
      </g>
    );
  }

  if (annotation.kind === "arrow") {
    return (
      <g>
        <line
          x1={annotation.x}
          y1={annotation.y}
          x2={annotation.toX}
          y2={annotation.toY}
          stroke={ANNOTATION_COLOR}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          markerEnd={`url(#${markerId})`}
        />
        {annotation.label ? (
          <text
            x={(annotation.x + annotation.toX) / 2}
            y={(annotation.y + annotation.toY) / 2 - 6}
            fill={ANNOTATION_COLOR}
            fontSize={14}
            fontWeight="bold"
            textAnchor="middle"
          >
            {annotation.label}
          </text>
        ) : null}
      </g>
    );
  }

  return <NumberBadge x={annotation.x} y={annotation.y} number={annotation.number} />;
}

/** 赤丸に白数字。枠の左上角に重ねる。 */
function NumberBadge({ x, y, number }: { x: number; y: number; number: number }) {
  return (
    <g data-help-badge={number}>
      <circle cx={x} cy={y} r={BADGE_RADIUS} fill={ANNOTATION_COLOR} />
      <text
        x={x}
        y={y}
        fill="#fff"
        fontSize={14}
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {number}
      </text>
    </g>
  );
}

/** marker の id を画像ごとに変える (同じページに複数枚あっても衝突しないように)。 */
function hashId(src: string): string {
  let hash = 0;
  for (let i = 0; i < src.length; i += 1) {
    hash = (hash * 31 + src.charCodeAt(i)) % 1000000007;
  }
  return hash.toString(36);
}
