import { toMetricNumber } from "../utils/therapyMetrics";

// Human-readable labels for raw DB/analytics metric keys
const METRIC_LABELS = {
    ahi_total: "AHI (breathing events/hr)",
    usage_hours: "therapy usage time",
    leak_p50: "median mask leak",
    leak_p95: "peak mask leak (95th pct)",
    pressure_median: "delivered pressure",
    minute_vent_p50: "minute ventilation",
    tidal_vol_p50: "tidal volume (breath depth)",
    resp_rate_p50: "respiratory rate",
    flow_limitation_p95: "flow limitation index",
};

// Direction-aware natural language for a flagged metric
function describeFlagInSidebar(metric, z) {
    const higher = z > 0;
    switch (metric) {
        case "ahi_total":
            return higher
                ? "AHI was notably higher than your recent average — more breathing pauses than usual during the night."
                : "AHI was unusually low — a positive sign of well-controlled therapy.";
        case "usage_hours":
            return higher
                ? "You used therapy longer than usual last night."
                : "Therapy was shorter than usual — check that the device ran through your full sleep window.";
        case "leak_p50":
        case "leak_p95":
            return higher
                ? "Mask leak was higher than your baseline — the seal may have been compromised during the night."
                : "Mask leak was unusually low — excellent seal maintained throughout.";
        case "pressure_median":
            return higher
                ? "Delivered pressure was higher than your recent average, possibly in response to more events."
                : "Delivered pressure was lower than your recent average.";
        case "minute_vent_p50":
            return higher
                ? "Breathing volume was notably higher than usual."
                : "Breathing volume was lower than usual — may indicate shallow breathing or flow limitation.";
        case "tidal_vol_p50":
            return higher
                ? "Breath depth (tidal volume) was above your baseline."
                : "Breath depth was below your baseline — could reflect reduced ventilation effectiveness.";
        default: {
            const label = METRIC_LABELS[metric] || metric;
            return higher
                ? `${label} was higher than your recent average.`
                : `${label} was lower than your recent average.`;
        }
    }
}

// ── Score decomposition component ────────────────────────────────────────────
function ScoreBar({ label, penalty, maxPenalty, color }) {
    const unavailable = penalty === null || penalty === undefined;
    const pct = maxPenalty > 0 ? Math.min((penalty / maxPenalty) * 100, 100) : 0;
    return (
        <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginBottom: 3 }}>
                <span style={{ color: 'var(--muted)' }}>{label}</span>
                <span style={{ color: unavailable ? 'var(--muted)' : penalty > 0 ? 'var(--critical)' : 'var(--success)', fontWeight: 600 }}>
                    {unavailable ? 'N/A' : penalty > 0 ? `-${penalty} pts` : 'Optimal'}
                </span>
            </div>
            <div style={{ background: 'var(--separator)', borderRadius: 3, height: 4 }}>
                <div style={{ width: unavailable ? '0%' : `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.8s ease' }} />
            </div>
        </div>
    );
}

/**
 * Last-night detail card: score-penalty breakdown + plain-English alert flags.
 * Presentational — the parent owns the getLastNightOverview fetch and passes
 * the result via `data`. The score ring and headline metrics now live in the
 * consolidated dashboard hero, so this card carries only the explanatory detail.
 */
export function LastNightDetails({ data }) {
    if (!data) return null;

    const outliers = data.outliers ? JSON.parse(data.outliers) : [];
    const scoreDetails = data.scoreDetails || {};

    // Leak p95 — treat 0 as no-data
    const leak95Val = toMetricNumber(data.leak_p95);
    const leak95Display = leak95Val !== null && leak95Val > 0 ? leak95Val : null;

    const pAhi = scoreDetails.penaltyAhi ?? null;
    const pLeak = scoreDetails.penaltyLeak ?? null;
    const pUsage = scoreDetails.penaltyUsage ?? null;
    const pPressVar = scoreDetails.penaltyPressureVar ?? null;
    const pFlow = scoreDetails.penaltyFlowLim ?? null;

    const hasAlerts =
        outliers.length > 0 ||
        (leak95Display !== null && leak95Display >= 24) ||
        (toMetricNumber(data.ahi_total) !== null && data.ahi_total > 5) ||
        (toMetricNumber(data.usage_hours) !== null && data.usage_hours < 4);

    return (
        <div className="detail-card">
            <div className="detail-card-header">
                <div className="section-eyebrow">Last Night Detail</div>
                <span className="detail-card-date">{data.night_date}</span>
            </div>

            <div className="detail-card-grid">
                {/* Score decomposition */}
                <div className="detail-breakdown">
                    <div style={{ fontSize: '0.66rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>Score Breakdown</div>
                    <ScoreBar label="Residual AHI Impact" penalty={pAhi} maxPenalty={50} color="var(--critical)" />
                    <ScoreBar label="Leak Stability" penalty={pLeak} maxPenalty={25} color="var(--warning)" />
                    <ScoreBar label="Usage Adherence" penalty={pUsage} maxPenalty={15} color="var(--cyan)" />
                    <ScoreBar label="Pressure Variance" penalty={pPressVar} maxPenalty={5} color="#8b5cf6" />
                    <ScoreBar label="Flow Limitation" penalty={pFlow} maxPenalty={5} color="var(--tier-orange)" />

                    {/* Alert flags — plain English, no raw keys */}
                    <div className="detail-alerts">
                        {!hasAlerts && (
                            <div className="detail-allclear">
                                No unusual readings flagged for last night — all metrics fell within your expected range.
                            </div>
                        )}
                        {outliers.length > 0 && outliers.map((o, i) => (
                            <div key={i} className="alert-flag alert-flag-critical">
                                <div className="alert-flag-title" style={{ color: "var(--critical)" }}>Unusual Reading Flagged</div>
                                <div className="alert-flag-body">{describeFlagInSidebar(o.metric, o.z)}</div>
                            </div>
                        ))}
                        {leak95Display !== null && leak95Display >= 24 && (
                            <div className="alert-flag alert-flag-warning">
                                <div className="alert-flag-title" style={{ color: "var(--warning)" }}>Elevated Mask Leak</div>
                                <div className="alert-flag-body">
                                    Peak leak ({leak95Display.toFixed(1)} L/min) exceeded the 24 L/min clinical threshold. This reduces effective pressure delivery and may allow unresolved events during the night.
                                </div>
                            </div>
                        )}
                        {toMetricNumber(data.ahi_total) !== null && data.ahi_total > 5 && (
                            <div className="alert-flag alert-flag-warning">
                                <div className="alert-flag-title" style={{ color: "var(--warning)" }}>AHI Above Normal Range</div>
                                <div className="alert-flag-body">
                                    AHI of {Number(data.ahi_total).toFixed(1)} events/hr is above the 5 events/hr threshold considered controlled therapy. Occasional elevated nights are common — watch for a persistent pattern.
                                </div>
                            </div>
                        )}
                        {toMetricNumber(data.usage_hours) !== null && data.usage_hours < 4 && (
                            <div className="alert-flag alert-flag-critical">
                                <div className="alert-flag-title" style={{ color: "var(--critical)" }}>Usage Below Compliance Minimum</div>
                                <div className="alert-flag-body">
                                    Therapy ran for {Number(data.usage_hours).toFixed(1)} hrs, under the 4-hour nightly minimum required for clinical compliance. Check your sleep schedule and address any comfort issues.
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
