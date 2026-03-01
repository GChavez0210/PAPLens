import React, { useMemo } from 'react';

export function CalendarHeatmap({ data }) {
    // data should be an array of night objects containing date string and therapy_stability_score

    const heatmapGrid = useMemo(() => {
        if (!data || data.length === 0) return [];

        // Simple 30 day grid for MVP
        const last30 = [...data].reverse().slice(0, 30);

        // Group into weeks (7 days blocks)
        const weeks = [];
        for (let i = 0; i < last30.length; i += 7) {
            weeks.push(last30.slice(i, i + 7));
        }
        return weeks;
    }, [data]);

    const getTierClass = (score) => {
        if (!score) return "tier-0"; // No data
        if (score >= 80) return "tier-1";
        if (score >= 60) return "tier-2";
        if (score >= 40) return "tier-3";
        return "tier-4";
    };

    return (
        <div className="panel heatmap-container" style={{ marginTop: "20px" }}>
            <h2>30-Day Efficacy Heatmap</h2>
            <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "10px" }}>
                {heatmapGrid.map((week, wIdx) => (
                    <div key={wIdx} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {week.map((day, dIdx) => (
                            <div
                                key={dIdx}
                                className={`heatmap-cell ${getTierClass(day.therapy_stability_score)}`}
                                title={`${day.date}: Efficacy ${Math.round(day.therapy_stability_score || 0)}`}
                                style={{
                                    width: "30px",
                                    height: "30px",
                                    borderRadius: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "10px",
                                    color: "rgba(255,255,255,0.7)",
                                    cursor: "crosshair"
                                }}
                            >
                                {day.date.split('-')[2]}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            <div style={{ display: "flex", gap: "15px", marginTop: "15px", fontSize: "0.8rem", color: "var(--muted)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "2px", background: "var(--success)" }} /> Stable (&gt;80)
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "2px", background: "var(--warning)" }} /> Watch (60-79)
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "2px", background: "var(--attention)" }} /> Attention (40-59)
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "2px", background: "var(--danger)" }} /> Critical (&lt;40)
                </span>
            </div>
        </div>
    );
}
