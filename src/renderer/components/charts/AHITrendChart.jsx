import { memo, useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import { SERIES, baseLegend, baseScales, baseTooltip } from "../../charts/chartTheme";

function rollingAvg(arr, window) {
    return arr.map((_, i) => {
        const slice = arr.slice(Math.max(0, i - window + 1), i + 1).filter(v => v !== null && v !== undefined);
        return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
    });
}

function AHITrendChartComponent({ labels, data, height = 200, theme = "dark" }) {
    const ref = useRef(null);
    const rolling = useMemo(() => rollingAvg(data, 7), [data]);

    useEffect(() => {
        if (!ref.current) return;
        const ctx = ref.current.getContext("2d");
        const scales = baseScales(theme);
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
                        maxBarThickness: 46,
                        order: 2
                    },
                    {
                        label: "7-day avg",
                        data: rolling,
                        type: "line",
                        borderColor: SERIES.amber,
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
                    legend: baseLegend(theme),
                    tooltip: { ...baseTooltip(theme), mode: "index", intersect: false }
                },
                scales: {
                    x: { ...scales.x, grid: { ...scales.x.grid, display: false }, ticks: { ...scales.x.ticks, maxRotation: 45 } },
                    y: scales.y
                }
            }
        });

        return () => chart.destroy();
    }, [labels, data, rolling, theme]);

    return (
        <div style={{ position: "relative", width: "100%", height: `${height}px` }}>
            <canvas ref={ref} role="img" aria-label="AHI Trend — nightly AHI bar chart with 7-day rolling average" />
        </div>
    );
}

export const AHITrendChart = memo(AHITrendChartComponent);
