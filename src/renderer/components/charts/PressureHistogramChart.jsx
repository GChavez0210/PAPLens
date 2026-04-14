import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

/**
 * Vertical column chart showing the pressure distribution for the selected range.
 * `histogram` is an array of { lo, hi, pct } objects, averaged across nights.
 *
 * Displayed as columns so pressure increases left-to-right (intuitive axis direction).
 */
export function PressureHistogramChart({ histogram, height = 200 }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!ref.current || !histogram || histogram.length === 0) return;

        const labels = histogram.map(b => `${b.lo}`);
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
                        // Colour gradient: low pressure = cool blue, high = warm amber/red
                        const t = i / Math.max(data.length - 1, 1);
                        const r = Math.round(34  + t * (239 - 34));
                        const g = Math.round(211 + t * (68  - 211));
                        const b = Math.round(238 + t * (68  - 238));
                        return `rgba(${r},${g},${b},0.80)`;
                    }),
                    borderRadius: 4,
                    borderSkipped: false,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: ctx => `${ctx[0].label} cmH₂O`,
                            label: ctx => `${ctx.parsed.y.toFixed(1)}% of session time`
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Pressure (cmH₂O)",
                            color: "#6b7280",
                            font: { size: 11 }
                        },
                        grid: { display: false },
                        ticks: { color: "#9ca3af", font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        max: 100,
                        title: {
                            display: true,
                            text: "% of Time",
                            color: "#6b7280",
                            font: { size: 11 }
                        },
                        grid: { color: "rgba(255,255,255,0.07)" },
                        ticks: {
                            color: "#6b7280",
                            callback: v => `${v}%`,
                            maxTicksLimit: 6
                        }
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
