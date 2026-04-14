import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

function rollingAvg(arr, window) {
    return arr.map((_, i) => {
        const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter(v => v !== null && v !== undefined);
        return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
    });
}

export function AHITrendChart({ labels, data, height = 200 }) {
    const ref = useRef(null);
    const rolling = rollingAvg(data, 7);

    useEffect(() => {
        if (!ref.current) return;
        const ctx = ref.current.getContext("2d");
        const chart = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "Nightly AHI",
                        data,
                        backgroundColor: data.map(val => (val >= 5 ? "rgba(239,68,68,0.65)" : "rgba(34,211,238,0.45)")),
                        borderRadius: 4,
                        order: 2
                    },
                    {
                        label: "7-day avg",
                        data: rolling,
                        type: "line",
                        borderColor: "#f59e0b",
                        backgroundColor: "transparent",
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2,
                        order: 1
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
                        labels: { color: "#9ca3af", font: { size: 11 }, boxWidth: 12, padding: 10 }
                    },
                    tooltip: { mode: "index", intersect: false }
                },
                scales: {
                    x: { display: true, grid: { display: false }, ticks: { color: "#6b7280", maxRotation: 45 } },
                    y: {
                        display: true,
                        grid: { color: "rgba(255,255,255,0.07)" },
                        beginAtZero: true,
                        ticks: { color: "#6b7280" }
                    }
                }
            }
        });

        return () => chart.destroy();
    }, [labels, data]);

    return (
        <div style={{ position: "relative", width: "100%", height: `${height}px` }}>
            <canvas ref={ref} />
        </div>
    );
}
