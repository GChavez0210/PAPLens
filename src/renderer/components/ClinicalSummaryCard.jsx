import React from "react";
import { isNoDataDay } from "../utils/reportBuilder";
import { formatMetricValue, toMetricNumber } from "../utils/therapyMetrics";

function getScoreTier(score) {
    if (score === null || score === undefined) return { tier: 0, badge: "badge-nodata", label: "N/A" };
    if (score >= 95) return { tier: 1, badge: "badge-t1", label: "Optimal" };
    if (score >= 85) return { tier: 2, badge: "badge-t2", label: "Stable" };
    if (score >= 70) return { tier: 3, badge: "badge-t3", label: "Acceptable" };
    if (score >= 50) return { tier: 4, badge: "badge-t4", label: "Suboptimal" };
    return { tier: 5, badge: "badge-t5", label: "High Risk" };
}

function getScoreMeaning(score) {
    if (score === null || score === undefined) return "Not enough derived data is available to compute a therapy score for this night.";
    if (score >= 95) return "Optimal Therapy - All metrics are within ideal clinical parameters.";
    if (score >= 85) return "Very Good Therapy - Minor deviations present but therapy is effective.";
    if (score >= 70) return "Good Therapy - Minor adjustments may further improve outcomes.";
    if (score >= 50) return "Improvement Recommended - Therapy efficacy is below expected targets.";
    return "Therapy May Not Be Effective - Significant clinical intervention may be needed.";
}

function formatFixed(value, digits = 1) {
    return formatMetricValue(value, digits);
}

export function ClinicalSummaryCard({ night, onSelect, isSelected }) {
    if (!night) return null;

    const noData = isNoDataDay(night);
    const score = noData || night.therapy_stability_score == null ? null : Math.round(night.therapy_stability_score);
    const badgeMeta = noData ? { badge: "badge-nodata", label: "No Data" } : getScoreTier(score);
    const metrics = night.raw || night;

    return (
        <div
            className={`clinical-card ${noData ? "clinical-card-nodata" : ""} ${isSelected ? "selected-card" : ""}`}
            onClick={() => onSelect && onSelect(night)}
            style={{ cursor: onSelect ? "pointer" : "default", borderColor: isSelected ? "var(--brand)" : undefined }}
        >
            <div className="cc-header">
                <div>
                    <strong style={{ fontSize: "1.1rem" }}>{night.date}</strong>
                    <span style={{ marginLeft: "10px", color: noData ? "var(--muted)" : "var(--brand)", fontWeight: "bold" }}>
                        {noData ? "No data" : `Score: ${score}`}
                    </span>
                </div>
                <div className={`cc-badge ${badgeMeta.badge}`}>{badgeMeta.label}</div>
            </div>

            <div className="cc-row">
                <div className="cc-stat">
                    <label>AHI</label>
                    <strong>{noData ? "-" : formatFixed(night.ahi, 1)}</strong>
                    <span>events/hr</span>
                </div>
                <div className="cc-stat">
                    <label>Leak.95</label>
                    <strong>{noData ? "-" : formatMetricValue(toMetricNumber(night.leak95) ?? toMetricNumber(night.leak50), 0)}</strong>
                    <span>L/min</span>
                </div>
                <div className="cc-stat">
                    <label>Pressure</label>
                    <strong>{noData ? "-" : formatFixed(metrics.pressure_median ?? night.pressure, 1)}</strong>
                    <span>cmH2O</span>
                </div>
                <div className="cc-stat">
                    <label>Usage</label>
                    <strong>{noData ? "No data" : formatFixed(night.usageHours, 1)}</strong>
                    <span>Hours</span>
                </div>
            </div>

            <div className="cc-row" style={{ marginTop: "15px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
                <div className="cc-stat">
                    <label>Consistency</label>
                    <strong>{noData ? "-" : (night.leak_consistency_index == null ? "N/A" : `${Math.round(night.leak_consistency_index)}%`)}</strong>
                    <span>stable</span>
                </div>
                <div className="cc-stat">
                    <label>Pres. Var</label>
                    <strong>{noData ? "-" : formatFixed(night.pressure_variance, 2)}</strong>
                    <span>SD</span>
                </div>
                <div className="cc-stat">
                    <label>Cluster</label>
                    <strong>{noData ? "-" : formatMetricValue(night.event_cluster_index, 0)}</strong>
                    <span>max/10m</span>
                </div>
                <div className="cc-stat">
                    <label>Flow Lim</label>
                    <strong>{noData ? "-" : formatMetricValue(night.flow_limitation_score, 0)}</strong>
                    <span>Score</span>
                </div>
            </div>

            <div className={`cc-footer ${noData ? "cc-footer-nodata" : ""}`}>
                {noData
                    ? "No therapy data was recorded for this date. It is shown in gray, excluded from therapy-quality scoring, and still counted in usage-based metrics such as adherence."
                    : getScoreMeaning(score)}
            </div>
        </div>
    );
}
