import { useEffect, useState, useRef } from "react";
import { formatMetricValue, toMetricNumber } from "../utils/therapyMetrics";

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

// ── Inline SVG sparkline (lightweight, no Chart.js) ─────────────────────────
function AhiSparkline({ data = [] }) {
    if (!data.length) return null;
    const W = 220, H = 28, PAD = 3;
    const values = data.map(d => d.ahi ?? 0);
    const max = Math.max(...values, 5.1); // at least 5.1 so threshold is visible
    const toY = v => PAD + (H - PAD * 2) * (1 - v / max);
    const toX = i => PAD + (i / (values.length - 1)) * (W - PAD * 2);

    const pts = values.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
    const areaPath = `M${toX(0)},${H} ` +
        values.map((v, i) => `L${toX(i)},${toY(v)}`).join(" ") +
        ` L${toX(values.length - 1)},${H} Z`;

    const threshY = toY(5);
    const gradId = "sparkGrad";

    return (
        <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                <span>7-Night AHI Trend</span>
                <span style={{ color: 'var(--warning)' }}>— AHI 5 threshold</span>
            </div>
            <svg width={W} height={H + PAD} style={{ display: 'block', borderRadius: 6, overflow: 'hidden' }}>
                <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                <path d={areaPath} fill={`url(#${gradId})`} />
                <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeLinejoin="round" />
                {/* Threshold line at AHI = 5 */}
                <line x1={PAD} y1={threshY} x2={W - PAD} y2={threshY} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" />
                {/* Last point dot */}
                <circle cx={toX(values.length - 1)} cy={toY(values[values.length - 1])} r={3} fill="#22d3ee" />
            </svg>
        </div>
    );
}

// ── Score decomposition component ────────────────────────────────────────────
function ScoreBar({ label, penalty, maxPenalty, color }) {
    const unavailable = penalty === null || penalty === undefined;
    const pct = maxPenalty > 0 ? Math.min((penalty / maxPenalty) * 100, 100) : 0;
    return (
        <div style={{ marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', marginBottom: 2 }}>
                <span style={{ color: 'var(--muted)' }}>{label}</span>
                <span style={{ color: unavailable ? 'var(--muted)' : penalty > 0 ? '#ef4444' : '#10b981', fontWeight: 600 }}>
                    {unavailable ? 'N/A' : penalty > 0 ? `-${penalty} pts` : 'Optimal'}
                </span>
            </div>
            <div style={{ background: 'var(--separator)', borderRadius: 3, height: 3 }}>
                <div style={{ width: unavailable ? '0%' : `${pct}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.8s ease' }} />
            </div>
        </div>
    );
}

export function LastNightSidebar() {
    const [data, setData] = useState(null);
    const prevScore = useRef(null);
    const [scoreAnimated, setScoreAnimated] = useState(false);

    const loadData = async () => {
        const res = await window.cpapAPI.getLastNightOverview();
        if (res) {
            const newScore = res.therapy_stability_score == null ? null : Math.round(res.therapy_stability_score);
            if (prevScore.current !== null && prevScore.current !== newScore) {
                setScoreAnimated(true);
                setTimeout(() => setScoreAnimated(false), 1300);
            }
            prevScore.current = newScore;
            setData(res);
        }
    };

    useEffect(() => {
        loadData();
        const unsub = window.cpapAPI.onDataLoaded(() => loadData());
        return () => unsub();
    }, []);

    if (!data) {
        return (
            <div style={{ padding: "0 10px" }}>
                <h3 style={{ fontSize: '0.82rem' }}>Last Night Overview</h3>
                <p style={{ color: "var(--muted)", fontSize: "0.8em" }}>No recent data available.</p>
            </div>
        );
    }

    const score = data.therapy_stability_score == null ? null : Math.round(data.therapy_stability_score);
    const outliers = data.outliers ? JSON.parse(data.outliers) : [];
    const scoreDetails = data.scoreDetails || {};

    // Score tier for color
    const scoreColor = score === null ? 'var(--muted)' : score >= 95 ? '#10b981' : score >= 85 ? '#22d3ee' : score >= 70 ? '#f59e0b' : score >= 50 ? '#f97316' : '#ef4444';
    const scoreTierLabel = score === null ? 'N/A' : score >= 95 ? 'Optimal' : score >= 85 ? 'Stable' : score >= 70 ? 'Acceptable' : score >= 50 ? 'Suboptimal' : 'High Risk';

    // Leak p95 — treat 0 as no-data
    const leak95Val = toMetricNumber(data.leak_p95);
    const leak95Display = leak95Val !== null && leak95Val > 0 ? leak95Val : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <h3 style={{ margin: "0 0 1px 0", fontSize: '0.82rem' }}>Last Night Overview</h3>
            <p style={{ margin: "0 0 8px 0", color: "var(--muted)", fontSize: "0.78em" }}>{data.night_date}</p>

            {/* Score hero */}
            <div style={{ textAlign: 'center', marginBottom: 10, padding: '8px 14px', background: 'var(--card-inner)', borderRadius: 10, border: `1px solid ${scoreColor}30` }}>
                <div
                    style={{ fontSize: '1.8rem', fontWeight: 900, color: scoreColor, lineHeight: 1, transition: 'color 0.5s' }}
                    className={scoreAnimated ? 'score-animated' : ''}
                >
                    {score ?? "N/A"}
                </div>
                <div style={{ fontSize: '0.65rem', color: scoreColor, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>{scoreTierLabel}</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: 1 }}>Treatment Score</div>
            </div>

            {/* Score decomposition */}
            {(() => {
                const pAhi = scoreDetails.penaltyAhi ?? null;
                const pLeak = scoreDetails.penaltyLeak ?? null;
                const pUsage = scoreDetails.penaltyUsage ?? null;
                const pPressVar = scoreDetails.penaltyPressureVar ?? null;
                const pFlow = scoreDetails.penaltyFlowLim ?? null;

                return (
                    <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5, fontWeight: 700 }}>Score Breakdown</div>
                        <ScoreBar label="Residual AHI Impact" penalty={pAhi} maxPenalty={50} color="#ef4444" />
                        <ScoreBar label="Leak Stability" penalty={pLeak} maxPenalty={25} color="#f59e0b" />
                        <ScoreBar label="Usage Adherence" penalty={pUsage} maxPenalty={15} color="#22d3ee" />
                        <ScoreBar label="Pressure Variance" penalty={pPressVar} maxPenalty={5} color="#8b5cf6" />
                        <ScoreBar label="Flow Limitation" penalty={pFlow} maxPenalty={5} color="#f97316" />
                    </div>
                );
            })()}

            {/* Key metrics */}
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginBottom: "10px" }}>
                {[
                    ["AHI", `${formatMetricValue(data.ahi_total, 1)} ev/hr`],
                    ["Usage", `${formatMetricValue(data.usage_hours, 1)} hrs`],
                    ["Pressure", `${formatMetricValue(toMetricNumber(data.pressure_median) > 0 ? data.pressure_median : null, 1)} cmH₂O`],
                    ["Leak P95", `${formatMetricValue(leak95Display, 1)} L/min`],
                ].map(([label, val]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "var(--muted)" }}>{label}</span>
                        <strong>{val}</strong>
                    </div>
                ))}
            </div>

            {/* Alert flags — plain English, no raw keys */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: 8 }}>
                {outliers.length > 0 && outliers.map((o, i) => (
                    <div key={i} style={{ background: "rgba(239,68,68,0.1)", borderLeft: "3px solid #EF4444", padding: "8px 10px", fontSize: "0.80em", lineHeight: 1.5, borderRadius: "0 4px 4px 0" }}>
                        <div style={{ fontWeight: 700, color: "#ef4444", marginBottom: 2 }}>Unusual Reading Flagged</div>
                        <div style={{ color: "var(--text)" }}>{describeFlagInSidebar(o.metric, o.z)}</div>
                    </div>
                ))}
                {leak95Display !== null && leak95Display >= 24 && (
                    <div style={{ background: "rgba(245,158,11,0.1)", borderLeft: "3px solid #F59E0B", padding: "8px 10px", fontSize: "0.80em", lineHeight: 1.5, borderRadius: "0 4px 4px 0" }}>
                        <div style={{ fontWeight: 700, color: "#f59e0b", marginBottom: 2 }}>Elevated Mask Leak</div>
                        <div style={{ color: "var(--text)" }}>
                            Peak leak ({leak95Display.toFixed(1)} L/min) exceeded the 24 L/min clinical threshold. This reduces effective pressure delivery and may allow unresolved events during the night.
                        </div>
                    </div>
                )}
                {toMetricNumber(data.ahi_total) !== null && data.ahi_total > 5 && (
                    <div style={{ background: "rgba(245,158,11,0.1)", borderLeft: "3px solid #F59E0B", padding: "8px 10px", fontSize: "0.80em", lineHeight: 1.5, borderRadius: "0 4px 4px 0" }}>
                        <div style={{ fontWeight: 700, color: "#f59e0b", marginBottom: 2 }}>AHI Above Normal Range</div>
                        <div style={{ color: "var(--text)" }}>
                            AHI of {Number(data.ahi_total).toFixed(1)} events/hr is above the 5 events/hr threshold considered controlled therapy. Occasional elevated nights are common — watch for a persistent pattern.
                        </div>
                    </div>
                )}
                {toMetricNumber(data.usage_hours) !== null && data.usage_hours < 4 && (
                    <div style={{ background: "rgba(239,68,68,0.1)", borderLeft: "3px solid #EF4444", padding: "8px 10px", fontSize: "0.80em", lineHeight: 1.5, borderRadius: "0 4px 4px 0" }}>
                        <div style={{ fontWeight: 700, color: "#ef4444", marginBottom: 2 }}>Usage Below Compliance Minimum</div>
                        <div style={{ color: "var(--text)" }}>
                            Therapy ran for {Number(data.usage_hours).toFixed(1)} hrs, under the 4-hour nightly minimum required for clinical compliance. Check your sleep schedule and address any comfort issues.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
