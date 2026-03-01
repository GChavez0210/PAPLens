import { useEffect, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  scales: {
    x: {
      ticks: { maxTicksLimit: 10, color: "#9CA3AF" },
      grid: { color: "rgba(79,70,229,0.08)" }
    },
    y: {
      ticks: { color: "#9CA3AF" },
      grid: { color: "rgba(79,70,229,0.08)" }
    }
  },
  plugins: {
    title: { display: false },
    legend: {
      position: "bottom",
      labels: { color: "#CBD5E1", boxWidth: 14, boxHeight: 2 }
    }
  }
};

export function TrendChart({ title, labels, datasets, type = "line", options = {} }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    // Adjust options if expanded
    const mergedOptions = {
      ...baseOptions,
      ...options,
      scales: {
        ...baseOptions.scales,
        ...(options.scales || {})
      },
      plugins: {
        ...baseOptions.plugins,
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

    chartRef.current = new Chart(canvasRef.current, {
      type,
      data: { labels, datasets },
      options: mergedOptions
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [title, labels, datasets, isExpanded]);

  return (
    <div className={`chart-card ${isExpanded ? "expanded" : ""}`} onClick={() => setIsExpanded(!isExpanded)} title={isExpanded ? "Click to minimize" : "Click to expand"}>
      <h3>{title}</h3>
      <div className="canvas-container">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
