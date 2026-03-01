import React from "react";

// ── 5-Tier classification based on Treatment Score ───────────────────────────
function getScoreTier(score) {
    if (score >= 95) return { tier: 1, badge: "badge-t1", label: "Optimal" };
    if (score >= 85) return { tier: 2, badge: "badge-t2", label: "Stable" };
    if (score >= 70) return { tier: 3, badge: "badge-t3", label: "Acceptable" };
    if (score >= 50) return { tier: 4, badge: "badge-t4", label: "Suboptimal" };
    return { tier: 5, badge: "badge-t5", label: "High Risk" };
}

function getScoreMeaning(score) {
    if (score >= 95) return "Optimal Therapy — All metrics are within ideal clinical parameters.";
    if (score >= 85) return "Very Good Therapy — Minor deviations present but therapy is effective.";
    if (score >= 70) return "Good Therapy — Minor adjustments may further improve outcomes.";
    if (score >= 50) return "Improvement Recommended — Therapy efficacy is below expected targets.";
    return "Therapy May Not Be Effective — Significant clinical intervention may be needed.";
}

export function ClinicalSummaryCard({ night, onSelect, isSelected }) {
    if (!night) return null;

    const score = Math.round(night.therapy_stability_score || 0);
    const { badge, label } = getScoreTier(score);
    const metrics = night.raw || night;

    return (
        <div
            className={`clinical-card ${isSelected ? "selected-card" : ""}`}
            onClick={() => onSelect && onSelect(night)}
            style={{ cursor: onSelect ? "pointer" : "default", borderColor: isSelected ? "var(--brand)" : undefined }}
        >
            <div className="cc-header">
                <div>
                    <strong style={{ fontSize: "1.1rem" }}>{night.date}</strong>
                    <span style={{ marginLeft: "10px", color: "var(--brand)", fontWeight: "bold" }}>
                        Score: {score}
                    </span>
                </div>
                <div className={`cc-badge ${badge}`}>{label}</div>
            </div>

            <div className="cc-row">
                <div className="cc-stat">
                    <label>AHI</label>
                    <strong>{Number(night.ahi || 0).toFixed(1)}</strong>
                    <span>events/hr</span>
                </div>
                <div className="cc-stat">
                    <label>Leak.95</label>
                    <strong>{Math.round(night.leak95 || night.leak50 || 0)}</strong>
                    <span>L/min</span>
                </div>
                <div className="cc-stat">
                    <label>Pressure</label>
                    <strong>{Number(metrics.pressure_median || night.pressure || 0).toFixed(1)}</strong>
                    <span>cmH₂O</span>
                </div>
                <div className="cc-stat">
                    <label>Usage</label>
                    <strong>{Number(night.usageHours || 0).toFixed(1)}</strong>
                    <span>Hours</span>
                </div>
            </div>

            <div className="cc-row" style={{ marginTop: "15px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
                <div className="cc-stat">
                    <label>Consistency</label>
                    <strong>{Math.round(night.leak_consistency_index || 0)}%</strong>
                    <span>stable</span>
                </div>
                <div className="cc-stat">
                    <label>Pres. Var</label>
                    <strong>{Number(night.pressure_variance || 0).toFixed(2)}</strong>
                    <span>SD</span>
                </div>
                <div className="cc-stat">
                    <label>Cluster</label>
                    <strong>{Math.round(night.event_cluster_index || 0)}</strong>
                    <span>max/10m</span>
                </div>
                <div className="cc-stat">
                    <label>Flow Lim</label>
                    <strong>{Math.round(night.flow_limitation_score || 0)}</strong>
                    <span>Score</span>
                </div>
            </div>

            <div className="cc-footer">{getScoreMeaning(score)}</div>
        </div>
    );
}
