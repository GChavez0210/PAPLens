import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";
import { useTheme } from "../ThemeContext";
import { baseLegend, baseScales, baseTooltip } from "./chartTheme";

Chart.register(...registerables);

function isReferenceDataset(dataset) {
  // Reference = a flat clinical guide line (threshold / limit / benchmark).
  // Classify by label only — a dashed *data* series (e.g. "Maximum Leak (95th)",
  // "Upper Bound (95%)") is real data and must still count toward axis scaling.
  return /threshold|limit|benchmark/i.test(dataset?.label || "");
}

function getDataValueMax(datasets) {
  let primaryMax = 0;
  let referenceMax = 0;

  for (const dataset of datasets || []) {
    const target = isReferenceDataset(dataset) ? "reference" : "primary";
    for (const point of dataset?.data || []) {
      const value = typeof point === "number" ? point : Number(point?.y ?? point);
      if (!Number.isFinite(value)) continue;
      if (target === "reference") {
        referenceMax = Math.max(referenceMax, value);
      } else {
        primaryMax = Math.max(primaryMax, value);
      }
    }
  }

  return { primaryMax, referenceMax };
}

function normalizeDatasets(datasets, isExpanded, type) {
  return (datasets || []).map((dataset) => {
    // Bars only need a fill + a subtle rounded corner; the line-specific
    // properties below (tension, point radius, dashes) don't apply.
    if (type === "bar" && dataset.type !== "line") {
      return {
        borderRadius: 4,
        borderWidth: 0,
        maxBarThickness: 46,
        ...dataset
      };
    }

    const reference = isReferenceDataset(dataset);
    const showPoints = !reference && isExpanded;
    return {
      pointHitRadius: 10,
      spanGaps: false,
      fill: dataset.fill ?? false,
      ...dataset,
      borderDash: dataset.borderDash,
      pointRadius: dataset.pointRadius ?? (showPoints ? 2.4 : 0),
      pointHoverRadius: dataset.pointHoverRadius ?? (reference ? 0 : 4.5),
      borderWidth: dataset.borderWidth ?? (reference ? 1.4 : 2.25),
      tension: dataset.tension ?? (reference ? 0 : 0.28)
    };
  });
}

function TrendChartComponent({ title, labels, datasets, type = "line", options = {}, reportKey }) {
  const theme = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const chartOptions = useMemo(() => {
    const fontSize = isExpanded ? 13 : 11;
    const scales = baseScales(theme, { fontSize });
    const { primaryMax } = getDataValueMax(datasets);

    const dynamicBaseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 4, right: 8, bottom: 2, left: 2 } },
      interaction: { mode: "nearest", axis: "x", intersect: false },
      elements: {
        line: { borderCapStyle: "round", borderJoinStyle: "round" },
        point: { borderWidth: 1.5 }
      },
      scales: {
        x: {
          ...scales.x,
          ticks: { ...scales.x.ticks, maxTicksLimit: isExpanded ? 14 : 7 }
        },
        y: {
          ...scales.y,
          // Fit every series, including threshold/limit lines, so guide lines
          // always render as horizontal references rather than clipping off-top.
          grace: "12%",
          ticks: {
            ...scales.y.ticks,
            precision: primaryMax > 0 && primaryMax < 2 ? 1 : undefined,
            maxTicksLimit: isExpanded ? 8 : 6
          }
        }
      },
      plugins: {
        title: { display: false },
        legend: baseLegend(theme, { fontSize }),
        tooltip: baseTooltip(theme)
      }
    };

    const mergedOptions = {
      ...dynamicBaseOptions,
      ...options,
      scales: {
        ...dynamicBaseOptions.scales,
        ...(options.scales || {})
      },
      plugins: {
        ...dynamicBaseOptions.plugins,
        ...(options.plugins || {})
      }
    };

    if (isExpanded) {
      mergedOptions.plugins.legend = {
        ...mergedOptions.plugins.legend,
        labels: { ...mergedOptions.plugins.legend.labels, font: { size: 14 } }
      };
      if (mergedOptions.scales.x?.ticks) mergedOptions.scales.x.ticks.font = { size: 14 };
      if (mergedOptions.scales.y?.ticks) mergedOptions.scales.y.ticks.font = { size: 14 };
      if (mergedOptions.scales.y1?.ticks) mergedOptions.scales.y1.ticks.font = { size: 14 };
    }

    return mergedOptions;
  }, [datasets, isExpanded, options, theme]);

  const chartData = useMemo(() => ({
    labels,
    datasets: normalizeDatasets(datasets, isExpanded, type)
  }), [datasets, isExpanded, labels, type]);

  useEffect(() => {
    if (!isExpanded) return undefined;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsExpanded(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isExpanded]);

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }

    chartRef.current = new Chart(canvasRef.current, {
      type,
      data: { labels: [], datasets: [] },
      options: {}
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [type]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    chartRef.current.data = chartData;
    chartRef.current.options = chartOptions;
    chartRef.current.update();
  }, [chartData, chartOptions]);

  return (
    <>
      {isExpanded && <div className="chart-backdrop" onClick={() => setIsExpanded(false)} />}
      <div
        className={`chart-card ${isExpanded ? "expanded" : ""}`}
        data-report-key={reportKey || undefined}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (!isExpanded) setIsExpanded(true);
        }}
        onKeyDown={(e) => {
          if (!isExpanded && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setIsExpanded(true);
          }
        }}
        title={isExpanded ? "Click outside chart to minimize" : "Click to expand"}
      >
        <h3 onClick={(e) => isExpanded && e.stopPropagation()}>{title}</h3>
        <div className="canvas-container" onClick={(e) => isExpanded && e.stopPropagation()}>
          <canvas ref={canvasRef} role="img" aria-label={title} />
        </div>
      </div>
    </>
  );
}

export const TrendChart = memo(TrendChartComponent);
