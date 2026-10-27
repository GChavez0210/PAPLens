import { memo, useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import { baseLegend, baseScales, baseTooltip, seriesPalette, statusColors, withAlpha } from "../../charts/chartTheme";
import { FLOW_LIMITATION_MILD, FLOW_LIMITATION_SIGNIFICANT } from "../../constants";

/**
 * Dual-line chart showing flow_limitation_p95 and rin_per_hr (Respiratory Disturbance Index)
 * over the selected date range.
 */
function FlowLimitationChartComponent({ trends, height = 200, theme = "dark" }) {
  const ref = useRef(null);

  const nights = useMemo(
    () => (trends || []).filter((d) => d.flow_limitation_p95 !== null && d.flow_limitation_p95 !== undefined),
    [trends]
  );

  useEffect(() => {
    if (!ref.current || nights.length === 0) return;
    const labels = nights.map((d) => d.night_date?.slice(5));
    const ctx = ref.current.getContext("2d");
    const scales = baseScales(theme);
    const palette = seriesPalette(theme);
    const status = statusColors(theme);
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Flow Limitation P95",
            data: nights.map((d) => d.flow_limitation_p95 ?? null),
            borderColor: palette.ochre,
            backgroundColor: withAlpha(palette.ochre, 0.08),
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.75,
            fill: true,
            yAxisID: "yFL"
          },
          {
            label: "RIN (events/hr)",
            data: nights.map((d) => d.rin_per_hr ?? null),
            borderColor: palette.plum,
            backgroundColor: withAlpha(palette.plum, 0.07),
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 1.75,
            fill: true,
            yAxisID: "yRIN"
          },
          {
            label: `Mild threshold (${FLOW_LIMITATION_MILD.toFixed(2)})`,
            data: nights.map(() => FLOW_LIMITATION_MILD),
            borderColor: withAlpha(status.watch, 0.5),
            borderWidth: 1,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
            yAxisID: "yFL",
            tension: 0
          },
          {
            label: `Significant threshold (${FLOW_LIMITATION_SIGNIFICANT.toFixed(2)})`,
            data: nights.map(() => FLOW_LIMITATION_SIGNIFICANT),
            borderColor: withAlpha(status.alert, 0.5),
            borderWidth: 1,
            borderDash: [5, 4],
            pointRadius: 0,
            fill: false,
            yAxisID: "yFL",
            tension: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: baseLegend(theme),
          tooltip: baseTooltip(theme)
        },
        scales: {
          x: { ...scales.x, ticks: { ...scales.x.ticks, maxRotation: 45 } },
          yFL: {
            ...scales.y,
            position: "left",
            max: 1,
            ticks: { ...scales.y.ticks, color: palette.ochre },
            title: { display: true, text: "FL P95 (0–1)", color: palette.ochre, font: { size: 10 } }
          },
          yRIN: {
            ...scales.y,
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { ...scales.y.ticks, color: palette.plum },
            title: { display: true, text: "RIN (events/hr)", color: palette.plum, font: { size: 10 } }
          }
        }
      }
    });
    return () => chart.destroy();
  }, [nights, theme]);

  if (nights.length === 0) return null;
  return (
    <div className="chart-canvas" style={{ height: `${height}px` }}>
      <canvas
        ref={ref}
        role="img"
        aria-label="Flow Limitation & Respiratory Disturbance — Flow Limitation P95 and RIN trend over time"
      />
    </div>
  );
}

export const FlowLimitationChart = memo(FlowLimitationChartComponent);
