import { isNoDataDay } from "../utils/reportBuilder";
import { formatMetricValue, toMetricNumber } from "../utils/therapyMetrics";
import { AHI_MILD, AHI_MODERATE, LEAK_SEVERITY_P95, LEAK_SEVERITY_P50 } from "../constants";

/**
 * Severity tints. Missing values render as "normal" so N/A stays neutral,
 * matching the old breakdown panel's behavior.
 */
function ahiSeverityClass(value) {
    const v = toMetricNumber(value);
    if (v === null) return "normal";
    return v < AHI_MILD ? "normal" : v <= AHI_MODERATE ? "warning" : "critical";
}

/**
 * Leak severity uses the percentile-calibrated tiers from clinicalThresholds
 * (p50 distributions run ~half the p95 scale): "high" → warning, "severe" →
 * critical. For p95 that means amber at 12 and red at 24 L/min — the clinical
 * large-leak limit providers screen against.
 */
function leakSeverityClass(value, tiers) {
    const v = toMetricNumber(value);
    if (v === null) return "normal";
    if (v >= tiers.severe) return "critical";
    if (v >= tiers.high) return "warning";
    return "normal";
}

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

/** Return value only if it is a positive finite number; otherwise null → "N/A" */
function positiveOrNull(value) {
    const n = toMetricNumber(value);
    return n !== null && n > 0 ? n : null;
}

/** Format flow limitation score: null → N/A, 0 → "None", >0 → numeric */
function formatFlowLim(value) {
    const n = toMetricNumber(value);
    if (n === null) return "N/A";
    if (n === 0) return "None";
    return String(Math.round(n));
}

/** Format leak consistency index: null → N/A, otherwise percentage */
function formatConsistency(value) {
    const n = toMetricNumber(value);
    if (n === null) return "N/A";
    return `${Math.round(n)}%`;
}

export function ClinicalSummaryCard({ night, onSelect, isSelected }) {
    if (!night) return null;

    const noData = isNoDataDay(night);
    const score = noData || night.therapy_stability_score == null ? null : Math.round(night.therapy_stability_score);
    const badgeMeta = noData ? { badge: "badge-nodata", label: "No Data" } : getScoreTier(score);
    const metrics = night.raw || night;

    // Leak: prefer p95, fall back to p50 — treat 0 as no-data for both
    const leak95 = positiveOrNull(night.leak95);
    const leak50 = positiveOrNull(night.leak50);
    const leakDisplay = formatMetricValue(leak95 ?? leak50, 0);

    // Pressure: treat 0 as no-data
    const pressure = positiveOrNull(metrics.pressure_median ?? night.pressure);

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
                    <strong className={noData ? undefined : `badge badge-${ahiSeverityClass(night.ahi)}`}>
                        {noData ? "-" : formatMetricValue(night.ahi, 1)}
                    </strong>
                    <span>events/hr</span>
                </div>
                <div className="cc-stat">
                    <label>{leak95 == null && leak50 != null ? "Leak P50" : "Leak P95"}</label>
                    <strong className={noData ? undefined : `badge badge-${leakSeverityClass(leak95 ?? leak50, leak95 != null ? LEAK_SEVERITY_P95 : LEAK_SEVERITY_P50)}`}>
                        {noData ? "-" : leakDisplay}
                    </strong>
                    <span>L/min</span>
                </div>
                <div className="cc-stat">
                    <label>Pressure</label>
                    <strong>{noData ? "-" : formatMetricValue(pressure, 1)}</strong>
                    <span>cmH₂O</span>
                </div>
                <div className="cc-stat">
                    <label>Usage</label>
                    <strong>{noData ? "No data" : formatMetricValue(night.usageHours, 1)}</strong>
                    <span>Hours</span>
                </div>
            </div>

            <div className="cc-row" style={{ marginTop: "15px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
                <div className="cc-stat">
                    <label>Consistency</label>
                    <strong>{noData ? "-" : formatConsistency(night.leak_consistency_index)}</strong>
                    <span>leak var.</span>
                </div>
                <div className="cc-stat">
                    <label>Pres. Var</label>
                    <strong>{noData ? "-" : formatMetricValue(night.pressure_variance, 2)}</strong>
                    <span>SD</span>
                </div>
                <div className="cc-stat">
                    <label>Cluster</label>
                    <strong>{noData ? "-" : formatMetricValue(night.event_cluster_index, 0)}</strong>
                    <span>max/10m</span>
                </div>
                <div className="cc-stat">
                    <label>Flow Lim</label>
                    <strong>{noData ? "-" : formatFlowLim(night.flow_limitation_score)}</strong>
                    <span>penalty</span>
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
