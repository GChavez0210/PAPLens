import { memo, useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import { baseLegend, baseScales, baseTooltip, seriesPalette, statusColors, withAlpha } from "../../charts/chartTheme";
import { AHI_MILD } from "../../constants";

function rollingAvg(arr, window) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter((v) => v !== null && v !== undefined);
    return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

function AHITrendChartComponent({ labels, data, height = 200, theme = "dark" }) {
  const ref = useRef(null);
  const rolling = useMemo(() => rollingAvg(data, 7), [data]);

  useEffect(() => {
    if (!ref.current) return;
    const ctx = ref.current.getContext("2d");
    const scales = baseScales(theme);
    const palette = seriesPalette(theme);
    const status = statusColors(theme);
    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Nightly AHI",
            // Status color marks the nights that cross the clinical
            // threshold; everything else stays a neutral series hue.
            data,
            backgroundColor: data.map((val) =>
              val >= AHI_MILD ? withAlpha(status.alert, 0.7) : withAlpha(palette.blue, 0.5)
            ),
            borderRadius: 2,
            maxBarThickness: 42,
            order: 2
          },
          {
            label: "7-day avg",
            data: rolling,
            type: "line",
            borderColor: palette.ochre,
            backgroundColor: "transparent",
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 1.75,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: baseLegend(theme),
          tooltip: { ...baseTooltip(theme), mode: "index", intersect: false }
        },
        scales: {
          x: { ...scales.x, ticks: { ...scales.x.ticks, maxRotation: 45 } },
          y: scales.y
        }
      }
    });

    return () => chart.destroy();
  }, [labels, data, rolling, theme]);

  return (
    <div className="chart-canvas" style={{ height: `${height}px` }}>
      <canvas ref={ref} role="img" aria-label="AHI Trend — nightly AHI bar chart with 7-day rolling average" />
    </div>
  );
}

export const AHITrendChart = memo(AHITrendChartComponent);
