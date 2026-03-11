import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { toMetricNumber } from "../../utils/therapyMetrics";

export function LeakSeverityGauge({ leak50, leak95, height = 150 }) {
    const ref = useRef(null);
    const leak50Value = toMetricNumber(leak50) ?? 0;
    const leak95Value = toMetricNumber(leak95);

    useEffect(() => {
        if (!ref.current || leak95Value === null) return;
        const ctx = ref.current.getContext("2d");

        // Simple doughnut gauge
        const chart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["Median Leak", "95th Pctl Leak", "Remaining Threshold"],
                datasets: [
                    {
                        data: [leak50Value, Math.max(0, leak95Value - leak50Value), Math.max(0, 24 - leak95Value)],
                        backgroundColor: ["#10b981", "#f59e0b", "rgba(255,255,255,0.05)"],
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
                    tooltip: { enabled: true }
                },
                cutout: "80%"
            }
        });

        return () => chart.destroy();
    }, [leak50Value, leak95Value]);

    return (
        <div style={{ textAlign: "center", position: "relative" }}>
            <div style={{ height: `${height}px`, width: "100%", position: "relative" }}>
                {leak95Value === null ? (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "1.1rem", fontWeight: 700 }}>
                        N/A
                    </div>
                ) : (
                    <canvas ref={ref} />
                )}
            </div>
            <div style={{ position: "absolute", top: "70%", left: "50%", transform: "translate(-50%, -50%)" }}>
                <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#f59e0b" }}>
                    {leak95Value === null ? "N/A" : leak95Value.toFixed(1)}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>L/min (95th)</div>
            </div>
        </div>
    );
}
