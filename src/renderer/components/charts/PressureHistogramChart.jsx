import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

/**
 * Horizontal bar chart showing the pressure distribution for a single night
 * (or averaged across the selected range).
 * `histogram` is an array of { lo, hi, pct } objects from the DB.
 */
export function PressureHistogramChart({ histogram, height = 180 }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!ref.current || !histogram || histogram.length === 0) return;
        const labels = histogram.map(b => `${b.lo}–${b.hi}`);
        const data = histogram.map(b => Number(b.pct?.toFixed(1) ?? 0));
        const ctx = ref.current.getContext("2d");
        const chart = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label: "% of session",
                    data,
                    backgroundColor: data.map((_, i) => {
                        // Colour gradient: low pressure = cyan, high = red
                        const t = i / (data.length - 1);
                        const r = Math.round(34 + t * (239 - 34));
                        const g = Math.round(211 + t * (68 - 211));
                        const b = Math.round(238 + t * (68 - 238));
                        return `rgba(${r},${g},${b},0.75)`;
                    }),
                    borderRadius: 3
                }]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.parsed.x.toFixed(1)}% of session`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        max: 100,
                        grid: { color: "rgba(255,255,255,0.07)" },
                        ticks: { color: "#6b7280", callback: v => `${v}%` }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: "#9ca3af", font: { size: 11 } }
                    }
                }
            }
        });
        return () => chart.destroy();
    }, [histogram]);

    if (!histogram || histogram.length === 0) return null;
    return (
        <div style={{ position: "relative", width: "100%", height: `${height}px` }}>
            <canvas ref={ref} />
        </div>
    );
}
