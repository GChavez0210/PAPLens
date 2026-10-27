import { memo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { baseScales, baseTooltip, chartColors, seriesPalette, withAlpha } from "../../charts/chartTheme";

/**
 * Vertical column chart showing the pressure distribution for the selected range.
 * `histogram` is an array of { lo, hi, pct } objects, averaged across nights.
 *
 * Displayed as columns so pressure increases left-to-right (intuitive axis direction).
 */
function PressureHistogramChartComponent({ histogram, height = 200, theme = "dark" }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !histogram || histogram.length === 0) return;

    const labels = histogram.map((b) => `${b.lo}`);
    const data = histogram.map((b) => Number(b.pct?.toFixed(1) ?? 0));
    const ctx = ref.current.getContext("2d");
    const colors = chartColors(theme);
    const scales = baseScales(theme);
    const palette = seriesPalette(theme);

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "% of session",
            data,
            // Single-hue sequential ramp: more pressure reads as more
            // ink, rather than as a different (and meaningless) colour.
            backgroundColor: data.map((_, i) => {
              const t = i / Math.max(data.length - 1, 1);
              return withAlpha(palette.blue, 0.35 + t * 0.55);
            }),
            borderRadius: 1,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...baseTooltip(theme),
            callbacks: {
              title: (ctx) => `${ctx[0].label} cmH₂O`,
              label: (ctx) => `${ctx.parsed.y.toFixed(1)}% of session time`
            }
          }
        },
        scales: {
          x: {
            ...scales.x,
            title: {
              display: true,
              text: "Pressure (cmH₂O)",
              color: colors.mutedText,
              font: { size: 11 }
            }
          },
          y: {
            ...scales.y,
            max: 100,
            title: {
              display: true,
              text: "% of Time",
              color: colors.mutedText,
              font: { size: 11 }
            },
            ticks: {
              ...scales.y.ticks,
              callback: (v) => `${v}%`,
              maxTicksLimit: 6
            }
          }
        }
      }
    });

    return () => chart.destroy();
  }, [histogram, theme]);

  if (!histogram || histogram.length === 0) return null;
  return (
    <div className="chart-canvas" style={{ height: `${height}px` }}>
      <canvas
        ref={ref}
        role="img"
        aria-label="Pressure Distribution Histogram — average percentage of session time at each pressure level"
      />
    </div>
  );
}

export const PressureHistogramChart = memo(PressureHistogramChartComponent);
