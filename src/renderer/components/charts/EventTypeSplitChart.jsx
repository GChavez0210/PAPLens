import { memo, useEffect, useMemo, useRef } from "react";
import Chart from "chart.js/auto";
import { SERIES, baseLegend, baseScales, baseTooltip, chartColors } from "../../charts/chartTheme";

/**
 * Stacked bar showing nightly breakdown of event types:
 * Obstructive Apneas (OAI), Central Apneas (CAI), Unclassified Apneas (UAI), Hypopneas (HI).
 * Only rendered when at least one night has non-zero event type data.
 */
function EventTypeSplitChartComponent({ trends, height = 220, theme = "dark" }) {
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
        const colors = chartColors(theme);
        const scales = baseScales(theme);
        const chart = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "Obstructive (OA)",
                        data: nights.map(d => d.obstructive_apneas_per_hr ?? 0),
                        backgroundColor: SERIES.red,
                        borderRadius: 2
                    },
                    {
                        label: "Central (CA)",
                        data: nights.map(d => d.central_apneas_per_hr ?? 0),
                        backgroundColor: SERIES.violet,
                        borderRadius: 2
                    },
                    {
                        label: "Unclassified (UA)",
                        data: nights.map(d => d.unclassified_apneas_per_hr ?? 0),
                        backgroundColor: SERIES.amber,
                        borderRadius: 2
                    },
                    {
                        label: "Hypopneas (H)",
                        data: nights.map(d => d.hypopneas_per_hr ?? 0),
                        backgroundColor: SERIES.cyan,
                        borderRadius: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: baseLegend(theme),
                    tooltip: { ...baseTooltip(theme), mode: "index", intersect: false }
                },
                scales: {
                    x: { ...scales.x, stacked: true, grid: { ...scales.x.grid, display: false }, ticks: { ...scales.x.ticks, maxRotation: 45 } },
                    y: {
                        ...scales.y,
                        stacked: true,
                        title: { display: true, text: "events / hr", color: colors.mutedText, font: { size: 11 } }
                    }
                }
            }
        });
        return () => chart.destroy();
    }, [nights, theme]);

    if (nights.length === 0) return null;
    return (
        <div style={{ position: "relative", width: "100%", height: `${height}px` }}>
            <canvas ref={ref} role="img" aria-label="Event Type Breakdown — stacked bar chart of obstructive, central, unclassified apneas and hypopneas per hour" />
        </div>
    );
}

export const EventTypeSplitChart = memo(EventTypeSplitChartComponent);
