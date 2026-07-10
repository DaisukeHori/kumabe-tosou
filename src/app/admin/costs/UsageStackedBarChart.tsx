import { computeStackedBarChart, type StackedBarInput } from "./chart";
import { PROVIDER_FILL_CLASS, PROVIDER_LABEL, PROVIDER_SWATCH_CLASS } from "./provider-meta";
import { formatUsd, PROVIDERS } from "./aggregate";

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;

/**
 * 日別積み上げ棒グラフ (直近30日、プロバイダ別色分け)。recharts 等は使わず SVG 自作
 * (設計書 §9、依存追加ゼロ)。座標計算は chart.ts の純関数に切り出し済み。
 * インタラクションは不要 (静的表示 + <title> によるホバーツールチップのみ) のため
 * Server Component のまま描画し、クライアント JS を増やさない。
 */
export function UsageStackedBarChart({ data }: { data: StackedBarInput[] }) {
  const layout = computeStackedBarChart(data, { width: CHART_WIDTH, height: CHART_HEIGHT, gap: 2 });

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="日別のプロバイダ別 AI 利用料金 (直近30日)"
        className="h-40 w-full"
      >
        {layout.bars.map((bar) =>
          bar.segments.map((seg) =>
            seg.height > 0 ? (
              <rect
                key={`${bar.date}-${seg.provider}`}
                x={seg.x}
                y={seg.y}
                width={Math.max(0, bar.barWidth)}
                height={seg.height}
                className={PROVIDER_FILL_CLASS[seg.provider]}
              >
                <title>
                  {bar.date} {PROVIDER_LABEL[seg.provider]}: {formatUsd(seg.value)}
                </title>
              </rect>
            ) : null,
          ),
        )}
      </svg>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {PROVIDERS.map((provider) => (
          <span key={provider} className="inline-flex items-center gap-1.5">
            <span className={`inline-block size-2.5 rounded-full ${PROVIDER_SWATCH_CLASS[provider]}`} />
            {PROVIDER_LABEL[provider]}
          </span>
        ))}
      </div>
    </div>
  );
}
