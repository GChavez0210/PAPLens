import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

export function AHITrendChart({ labels, data, height = 200 }) {
    const ref = useRef(null);

    useEffect(() => {
        if (!ref.current) return;
        const ctx = ref.current.getContext("2d");
        const chart = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "AHI",
                        data,
                        backgroundColor: data.map(val => (val >= 5 ? "#ef4444" : "#22D3EE")),
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { mode: "index", intersect: false }
                },
                scales: {
                    x: { display: true, grid: { display: false } },
                    y: {
                        display: true,
                        grid: { color: "rgba(255,255,255,0.1)" },
                        beginAtZero: true
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
