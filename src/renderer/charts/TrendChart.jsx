import { useEffect, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);



export function TrendChart({ title, labels, datasets, type = "line", options = {}, theme = "dark" }) {
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

    const textColor = theme === 'light' ? '#6b7280' : '#a1a1aa';
    const gridColor = theme === 'light' ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.15)';

    const dynamicBaseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10, color: textColor },
          grid: { color: gridColor, drawBorder: false }
        },
        y: {
          ticks: { color: textColor },
          grid: { color: gridColor, drawBorder: false }
        }
      },
      plugins: {
        title: { display: false },
        legend: {
          position: "bottom",
          labels: { color: textColor, boxWidth: 14, boxHeight: 2 }
        }
      }
    };

    // Adjust options if expanded
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
  }, [title, labels, datasets, isExpanded, theme]);

  return (
    <div className={`chart-card ${isExpanded ? "expanded" : ""}`} onClick={() => setIsExpanded(!isExpanded)} title={isExpanded ? "Click to minimize" : "Click to expand"}>
      <h3>{title}</h3>
      <div className="canvas-container">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
