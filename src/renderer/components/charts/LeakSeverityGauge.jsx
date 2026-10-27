import { memo, useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { toMetricNumber } from "../../utils/therapyMetrics";
import { baseTooltip, chartColors, statusColors } from "../../charts/chartTheme";
import { LEAK_HIGH } from "../../constants";

/** Status tier for the 95th-percentile leak reading. */
function leakTier(leak95) {
  if (leak95 === null) return "is-na";
  if (leak95 >= LEAK_HIGH) return "is-alert";
  if (leak95 >= LEAK_HIGH / 2) return "is-watch";
  return "is-ok";
}

function LeakSeverityGaugeComponent({ leak50, leak95, height = 150, theme = "dark" }) {
  const ref = useRef(null);
  const leak50Value = toMetricNumber(leak50) ?? 0;
  const leak95Value = toMetricNumber(leak95);

  useEffect(() => {
    if (!ref.current || leak95Value === null) return;
    const ctx = ref.current.getContext("2d");
    const status = statusColors(theme);

    const chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Median Leak", "95th Pctl Leak", "Remaining Threshold"],
        datasets: [
          {
            data: [leak50Value, Math.max(0, leak95Value - leak50Value), Math.max(0, LEAK_HIGH - leak95Value)],
            backgroundColor: [status.ok, status.watch, chartColors(theme).track],
            borderWidth: 0,
            circumference: 180,
            rotation: 270
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: baseTooltip(theme)
        },
        cutout: "84%"
      }
    });

    return () => chart.destroy();
  }, [leak50Value, leak95Value, theme]);

  return (
    <div className="leak-gauge">
      <div className="leak-gauge-canvas" style={{ height: `${height}px` }}>
        {leak95Value === null ? (
          <div className="leak-gauge-empty">N/A</div>
        ) : (
          <canvas
            ref={ref}
            role="img"
            aria-label={`Mask Leak Severity Gauge — median ${leak50Value.toFixed(1)} L/min, 95th percentile ${leak95Value.toFixed(1)} L/min`}
          />
        )}
      </div>
      <div className="leak-gauge-readout">
        <div className={`leak-gauge-value ${leakTier(leak95Value)}`}>
          {leak95Value === null ? "N/A" : leak95Value.toFixed(1)}
        </div>
        <div className="leak-gauge-unit">L/min (95th)</div>
      </div>
    </div>
  );
}

export const LeakSeverityGauge = memo(LeakSeverityGaugeComponent);
