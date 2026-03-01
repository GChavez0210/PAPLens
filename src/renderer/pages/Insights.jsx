import { useEffect, useRef, useState } from "react";

// ── Icon map ────────────────────────────────────────────────────────────────
const ICONS = {
    stability: "🫁",   // Efficacy
    mask_fit: "😷",
    compliance: "⏱️",
    outlier: "⚠️",
    default: "📊",
};

const KEY_COLOR = {
    stability: { border: "#22D3EE", bg: "rgba(34,211,238,0.08)" },
    mask_fit: { border: "#10b981", bg: "rgba(16,185,129,0.08)" },
    compliance: { border: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
    outlier: { border: "#ef4444", bg: "rgba(239,68,68,0.08)" },
    default: { border: "#4F46E5", bg: "rgba(79,70,229,0.08)" },
};

// ── Mini sparkline ───────────────────────────────────────────────────────────
function MiniChart({ labels, datasets, height = 100 }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current) return;
        const ctx = ref.current.getContext("2d");
        const chart = new Chart(ctx, {
            type: "line",
            data: { labels, datasets },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { mode: "index", intersect: false } },
                scales: {
                    x: { display: false },
                    y: { display: true, grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#9ca3af", font: { size: 10 }, maxTicksLimit: 4 } }
                },
                elements: { point: { radius: 0 }, line: { tension: 0.4, borderWidth: 2 } }
            }
        });
        return () => chart.destroy();
    }, [labels, datasets]);
    // Fixed-height wrapper prevents Chart.js from growing the canvas indefinitely
    return (
        <div style={{ position: "relative", width: "100%", height: `${height}px`, overflow: "hidden" }}>
            <canvas ref={ref} width="100%" height={height} style={{ display: "block", width: "100%", height: `${height}px` }} />
        </div>
    );
}

// ── Correlation tooltips — pair + r-value aware ───────────────────────────────
function getCorrelationInsight(pair, r) {
    const p = (pair || "").toLowerCase();
    const hasAll = (...terms) => terms.every(t => p.includes(t));

    // Leak ↔ AHI
    if ((hasAll("leak") && hasAll("ahi")) || (hasAll("ahi") && hasAll("leak"))) {
        if (r <= -0.20) return "Negative relationship. Higher leak corresponds with lower AHI — uncommon; may indicate detection artifacts or statistical noise.";
        if (r < 0.20) return "Minimal relationship. Leak is unlikely affecting AHI.";
        if (r < 0.40) return "Mild positive. Higher leak may slightly increase AHI; mask fit could influence therapy quality.";
        if (r < 0.60) return "Moderate positive. Leak is likely impacting event control and reducing effective pressure delivery.";
        return "Strong positive. Leak is a major driver of elevated AHI and should be prioritized for correction.";
    }

    // Pressure ↔ AHI
    if ((hasAll("pressure") && hasAll("ahi")) || (hasAll("ahi") && hasAll("pressure"))) {
        if (r <= -0.20) return "Negative relationship. Higher pressure is associated with lower AHI, indicating effective event suppression.";
        if (r < 0.20) return "No meaningful relationship. Pressure changes are not influencing AHI.";
        if (r < 0.40) return "Mild positive. Higher pressures coincide with higher AHI; may reflect reactive pressure increases to events.";
        if (r < 0.60) return "Moderate positive. Pressure rises are strongly associated with elevated AHI, suggesting unresolved obstruction.";
        return "Strong positive. Pressure escalation is closely tied to event severity; therapy settings may need review.";
    }

    // Usage ↔ AHI
    if ((hasAll("usage") && hasAll("ahi")) || (hasAll("ahi") && hasAll("usage"))) {
        if (r <= -0.20) return "Negative relationship. Increased nightly usage corresponds with lower AHI, suggesting strong adherence benefit.";
        if (r < 0.20) return "No meaningful relationship. Duration of use is not affecting event control.";
        if (r < 0.40) return "Mild positive. Longer usage correlates with slightly higher AHI; may reflect extended REM or positional exposure.";
        if (r < 0.60) return "Moderate positive. Extended usage aligns with higher AHI, possibly indicating late-night instability.";
        return "Strong positive. Longer use consistently coincides with higher events; further analysis required.";
    }

    // Pressure ↔ Leak
    if ((hasAll("pressure") && hasAll("leak")) || (hasAll("leak") && hasAll("pressure"))) {
        if (r <= -0.20) return "Negative relationship. Higher pressure corresponds with reduced leak, possibly due to improved mask stabilization.";
        if (r < 0.20) return "No meaningful relationship. Pressure changes are not affecting seal integrity.";
        if (r < 0.40) return "Mild positive. Higher pressures slightly increase leak; mask adjustment may be beneficial.";
        if (r < 0.60) return "Moderate positive. Pressure escalation is contributing to seal instability.";
        return "Strong positive. Pressure increases significantly worsen leak; mask type or fit likely unsuitable.";
    }

    // Fallback
    const absR = Math.abs(r);
    if (absR < 0.20) return "No meaningful correlation detected between these metrics.";
    if (absR < 0.40) return "Mild correlation. A weak but present relationship exists between these two variables.";
    if (absR < 0.60) return "Moderate correlation. These metrics show a meaningful clinical association.";
    return "Strong correlation. These metrics are significantly related and warrant clinical attention.";
}

function CorrelationBar({ r, pair, label }) {
    const [hovered, setHovered] = useState(false);
    const pct = Math.abs(r) * 100;
    const color = r > 0.4 ? "#22D3EE" : r < -0.4 ? "#ef4444" : "#9ca3af";
    const positive = r >= 0;
    const tooltipText = getCorrelationInsight(pair, r);

    // Determine strength badge
    const absR = Math.abs(r);
    const strength = absR >= 0.60 ? { label: "Strong", color: "#22D3EE" }
        : absR >= 0.40 ? { label: "Moderate", color: "#f59e0b" }
            : absR >= 0.20 ? { label: "Mild", color: "#9ca3af" }
                : { label: "Negligible", color: "#4b5563" };

    return (
        <div
            style={{ background: "var(--bg)", borderRadius: "8px", padding: "14px 16px", position: 'relative', cursor: 'help' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{pair}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 600, color: strength.color, background: `${strength.color}20`, borderRadius: 4, padding: '2px 6px' }}>{strength.label}</span>
                    <span style={{ color, fontWeight: 700, fontSize: "0.85rem" }}>r = {Number(r).toFixed(2)}</span>
                </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 4, height: 6, position: "relative" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.2)" }} />
                <div style={{
                    position: "absolute",
                    height: "100%",
                    width: `${pct / 2}%`,
                    borderRadius: 4,
                    background: color,
                    left: positive ? "50%" : `calc(50% - ${pct / 2}%)`,
                }} />
            </div>
            <div style={{ marginTop: 6, fontSize: "0.75rem", color: "#9ca3af" }}>{label || "Weak correlation"}</div>
            {hovered && (
                <div style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 50,
                    background: '#111827', border: '1px solid rgba(79,70,229,0.4)', borderRadius: 8,
                    padding: '12px 14px', fontSize: '0.78rem', color: '#d1d5db', lineHeight: 1.7,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.5)', pointerEvents: 'none'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, color: '#22D3EE', fontSize: '0.8rem' }}>Clinical Interpretation</span>
                        <span style={{ fontSize: '0.65rem', color: strength.color, fontWeight: 600 }}>r = {Number(r).toFixed(2)} — {strength.label}</span>
                    </div>
                    {tooltipText}
                </div>
            )}
        </div>
    );
}

// ── Burden gauge ─────────────────────────────────────────────────────────────
function BurdenStat({ value, total, label, color }) {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginBottom: 6 }}>{label}</div>
            <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 4, height: 4, width: "80%", margin: "0 auto" }}>
                <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4, transition: "width 0.8s" }} />
            </div>
            <div style={{ fontSize: "0.65rem", color: "#9ca3af", marginTop: 4 }}>{pct}% of nights</div>
        </div>
    );
}

// ── Insight card ─────────────────────────────────────────────────────────────
function InsightCard({ insight }) {
    const theme = KEY_COLOR[insight.key] || KEY_COLOR.default;
    const icon = ICONS[insight.key] || ICONS.default;
    return (
        <div style={{
            display: "flex", gap: 14, padding: "14px 16px",
            background: theme.bg, border: `1px solid ${theme.border}`,
            borderLeft: `4px solid ${theme.border}`,
            borderRadius: 8, alignItems: "flex-start"
        }}>
            <span style={{ fontSize: "1.6rem", lineHeight: 1, flexShrink: 0 }}>{icon}</span>
            <div>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "white" }}>{insight.title}</div>
                <div style={{ color: "#9ca3af", fontSize: "0.85rem", lineHeight: 1.5 }}>{insight.summary}</div>
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function Insights({ range = "30", customFrom = "", customTo = "" }) {
    const [data, setData] = useState(null);

    const loadData = async () => {
        let payload;
        if (range === "custom") {
            payload = { from: customFrom, to: customTo };
        } else if (range === "all") {
            payload = { days: 0 };
        } else {
            payload = { days: parseInt(range, 10) };
        }
        const res = await window.cpapAPI.getInsights(payload);
        if (res) setData(res);
    };

    useEffect(() => {
        setData(null); // show loading state on range change
        loadData();
        const unsub = window.cpapAPI.onDataLoaded(() => loadData());
        return () => unsub();
    }, [range, customFrom, customTo]);

    if (!data) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#9ca3af" }}>
            <span style={{ fontSize: "1.2rem" }}>Loading insights...</span>
        </div>
    );

    const { trends, correlations, explanations } = data;

    // Deduplicate explanations — keep one per key (most recent = first in result set)
    const seenKeys = new Set();
    const uniqueExplanations = (explanations || []).filter(exp => {
        if (seenKeys.has(exp.key)) return false;
        seenKeys.add(exp.key);
        return true;
    });

    // Reverse trends so they go oldest → newest
    const sorted = [...(trends || [])].reverse();
    const labels = sorted.map(d => d.night_date?.slice(5)); // MM-DD
    const ahiData = sorted.map(d => d.ahi_total || 0);
    const usageData = sorted.map(d => d.usage_hours || 0);
    const leakData = sorted.map(d => d.leak_p50 || 0);

    // Burden from last night
    let burden = null;
    const lastWithBurden = (trends || []).find(t => t.residual_burden);
    if (lastWithBurden) {
        try { burden = JSON.parse(lastWithBurden.residual_burden); } catch (_) { }
    }

    const totalNights = sorted.length;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* ── AVERAGES STAT BAR ─────────────────────────────── */}
            {sorted.length > 0 && (() => {
                const rangeLabel = range === 'all' ? 'All Time' : range === 'custom' ? 'Custom Range' : `Last ${range} Days`;
                // Include ALL nights (v >= 0), same as Dashboard filteredStats calculation
                const avg = (fn) => {
                    const vals = sorted.map(fn).filter(v => v != null && !isNaN(v) && v >= 0);
                    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                };
                const avgAhi = avg(d => d.ahi_total);
                const avgUsage = avg(d => d.usage_hours);
                const avgPress = avg(d => d.pressure_median);
                const avgLeak = avg(d => d.leak_p50);
                const avgFlow = avg(d => d.minute_vent_p50);
                const avgTv = avg(d => d.tidal_vol_p50);
                const StatCard = ({ label, value, unit, sub, color = "#22D3EE" }) => (
                    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: "0.65rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                            <span style={{ fontSize: "1.8rem", fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
                            <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{unit}</span>
                        </div>
                        {sub && <div style={{ fontSize: "0.65rem", color: "#6b7280" }}>{sub}</div>}
                    </div>
                );
                return (
                    <section className="panel" style={{ padding: 20 }}>
                        <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                            {rangeLabel} Averages
                        </h3>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
                            <StatCard label="Average AHI" value={avgAhi.toFixed(1)} unit="events/hr" sub={rangeLabel} color="#ef4444" />
                            <StatCard label="Average Usage" value={avgUsage.toFixed(1)} unit="hours" sub="per night" color="#10b981" />
                            <StatCard label="Average Pressure" value={avgPress.toFixed(1)} unit="cmH₂O" sub="50th percentile" color="#22D3EE" />
                            <StatCard label="Average Leak" value={avgLeak.toFixed(1)} unit="L/min" sub="50th percentile" color="#f59e0b" />
                            <StatCard label="Average Flow Rate" value={avgFlow.toFixed(1)} unit="L/min" sub="50th percentile" color="#8b5cf6" />
                            <StatCard label="Average Tidal Vol." value={avgTv.toFixed(0)} unit="mL" sub="50th percentile" color="#22D3EE" />
                            <StatCard label="Nights in Range" value={sorted.length} unit="" sub={rangeLabel} color="white" />
                        </div>
                    </section>
                );
            })()}

            {/* ── INSIGHT CARDS ──────────────────────────────────── */}
            {uniqueExplanations.length > 0 && (
                <section className="panel" style={{ padding: 20 }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                        🔎 Recent Findings
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {uniqueExplanations.map((exp, i) => <InsightCard key={i} insight={exp} />)}
                    </div>
                </section>
            )}

            {/* ── RESIDUAL BURDEN ─────────────────────────────────── */}
            {burden && totalNights > 0 && (
                <section className="panel" style={{ padding: 20 }}>
                    <h3 style={{ margin: "0 0 20px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                        📉 Residual Burden — {range === 'all' ? 'All Time' : range === 'custom' ? 'Custom Range' : `Last ${range} Nights`}
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                        <BurdenStat value={burden.nights_over_5 ?? 0} total={totalNights} label="Nights AHI > 5" color="#f59e0b" />
                        <BurdenStat value={burden.nights_over_10 ?? 0} total={totalNights} label="Nights AHI > 10" color="#ef4444" />
                        <div style={{ textAlign: "center" }}>
                            <div style={{ fontSize: "2rem", fontWeight: 800, color: "#22D3EE" }}>
                                {Number(burden.AHI_p95_30 || 0).toFixed(1)}
                            </div>
                            <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginBottom: 6 }}>AHI 95th Percentile</div>
                            <div style={{ fontSize: "0.65rem", color: "#9ca3af" }}>events / hr</div>
                        </div>
                    </div>
                </section>
            )}

            {/* ── CORRELATIONS ─────────────────────────────────────── */}
            <section className="panel" style={{ padding: 20 }}>
                <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                    🔗 Metric Correlations ({range === 'all' ? 'All Time' : range === 'custom' ? 'Custom Range' : `Last ${range} Days`})
                </h3>
                {correlations && correlations.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {correlations.map((c, i) => (
                            <CorrelationBar
                                key={i}
                                pair={`${c.x} ↔ ${c.y}`}
                                r={c.r}
                                label={c.label}
                            />
                        ))}
                    </div>
                ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#9ca3af", padding: "20px 0" }}>
                        <span style={{ fontSize: "1.5rem" }}>📊</span>
                        <span>Not enough data for correlations. Requires at least 2 nights of recorded sessions.</span>
                    </div>
                )}
            </section>
        </div>
    );
}
