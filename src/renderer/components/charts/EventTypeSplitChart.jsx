import { memo, useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";

/**
 * Stacked bar showing nightly breakdown of event types:
 * Obstructive Apneas (OAI), Central Apneas (CAI), Unclassified Apneas (UAI), Hypopneas (HI).
 * Only rendered when at least one night has non-zero event type data.
 */
function EventTypeSplitChartComponent({ trends, height = 220 }) {
    const ref = useRef(null);

    const nights = useMemo(
        () => (trends || []).filter(d =>
            (d.obstructive_apneas_per_hr ?? 0) + (d.central_apneas_per_hr ?? 0) +
            (d.unclassified_apneas_per_hr ?? 0) + (d.hypopneas_per_hr ?? 0) > 0
        ),
        [trends]
    );

    useEffect(() => {
        if (!ref.current || nights.length === 0) return;
        const labels = nights.map(d => d.night_date?.slice(5));
        const ctx = ref.current.getContext("2d");
        const chart = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "Obstructive (OA)",
                        data: nights.map(d => d.obstructive_apneas_per_hr ?? 0),
                        backgroundColor: "#ef4444",
                        borderRadius: 2
                    },
                    {
                        label: "Central (CA)",
                        data: nights.map(d => d.central_apneas_per_hr ?? 0),
                        backgroundColor: "#8b5cf6",
                        borderRadius: 2
                    },
                    {
                        label: "Unclassified (UA)",
                        data: nights.map(d => d.unclassified_apneas_per_hr ?? 0),
                        backgroundColor: "#f59e0b",
                        borderRadius: 2
                    },
                    {
                        label: "Hypopneas (H)",
                        data: nights.map(d => d.hypopneas_per_hr ?? 0),
                        backgroundColor: "#22D3EE",
                        borderRadius: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: "bottom",
                        labels: { color: "#9ca3af", font: { size: 11 }, boxWidth: 12, padding: 12 }
                    },
                    tooltip: { mode: "index", intersect: false }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: "#6b7280", maxRotation: 45 } },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: "rgba(255,255,255,0.07)" },
                        ticks: { color: "#6b7280" },
                        title: { display: true, text: "events / hr", color: "#6b7280", font: { size: 11 } }
                    }
                }
            }
        });
        return () => chart.destroy();
    }, [nights]);

    if (nights.length === 0) return null;
    return (
        <div style={{ position: "relative", width: "100%", height: `${height}px` }}>
            <canvas ref={ref} />
        </div>
    );
}

export const EventTypeSplitChart = memo(EventTypeSplitChartComponent);
