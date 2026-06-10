import { memo, useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";

/**
 * Dual-line chart showing flow_limitation_p95 and rin_per_hr (Respiratory Disturbance Index)
 * over the selected date range.
 */
function FlowLimitationChartComponent({ trends, height = 200 }) {
    const ref = useRef(null);

    const nights = useMemo(
        () => (trends || []).filter(d => d.flow_limitation_p95 !== null && d.flow_limitation_p95 !== undefined),
        [trends]
    );

    useEffect(() => {
        if (!ref.current || nights.length === 0) return;
        const labels = nights.map(d => d.night_date?.slice(5));
        const ctx = ref.current.getContext("2d");
        const chart = new Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "Flow Limitation P95",
                        data: nights.map(d => d.flow_limitation_p95 ?? null),
                        borderColor: "#f59e0b",
                        backgroundColor: "rgba(245,158,11,0.08)",
                        tension: 0.3,
                        pointRadius: 3,
                        fill: true,
                        yAxisID: "yFL"
                    },
                    {
                        label: "RIN (events/hr)",
                        data: nights.map(d => d.rin_per_hr ?? null),
                        borderColor: "#8b5cf6",
                        backgroundColor: "rgba(139,92,246,0.06)",
                        tension: 0.3,
                        pointRadius: 3,
                        fill: true,
                        yAxisID: "yRIN"
                    },
                    {
                        label: "Mild threshold (0.10)",
                        data: nights.map(() => 0.10),
                        borderColor: "rgba(245,158,11,0.45)",
                        borderWidth: 1,
                        borderDash: [5, 4],
                        pointRadius: 0,
                        fill: false,
                        yAxisID: "yFL",
                        tension: 0
                    },
                    {
                        label: "Significant threshold (0.30)",
                        data: nights.map(() => 0.30),
                        borderColor: "rgba(239,68,68,0.45)",
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
                    legend: {
                        display: true,
                        position: "bottom",
                        labels: { color: "#9ca3af", font: { size: 11 }, boxWidth: 12, padding: 12 }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: "#6b7280", maxRotation: 45 } },
                    yFL: {
                        position: "left",
                        beginAtZero: true,
                        max: 1,
                        grid: { color: "rgba(255,255,255,0.07)" },
                        ticks: { color: "#f59e0b" },
                        title: { display: true, text: "FL P95 (0–1)", color: "#f59e0b", font: { size: 10 } }
                    },
                    yRIN: {
                        position: "right",
                        beginAtZero: true,
                        grid: { drawOnChartArea: false },
                        ticks: { color: "#8b5cf6" },
                        title: { display: true, text: "RIN (events/hr)", color: "#8b5cf6", font: { size: 10 } }
                    }
                }
            }
        });
        return () => chart.destroy();
    }, [nights]);

    if (nights.length === 0) return null;
    return (
        <div style={{ position: "relative", width: "100%", height: `${height}px` }}>
            <canvas ref={ref} role="img" aria-label="Flow Limitation & Respiratory Disturbance — Flow Limitation P95 and RIN trend over time" />
        </div>
    );
}

export const FlowLimitationChart = memo(FlowLimitationChartComponent);
