import { useEffect, useState } from "react";
import { filterAnalyzedDays, getCorrelationInsight } from "../utils/reportBuilder";
import { calculatePercentile, formatMetricValue, toMetricNumber } from "../utils/therapyMetrics";
import { AHITrendChart } from "../components/charts/AHITrendChart";
import { TherapyStabilityCard } from "../components/charts/TherapyStabilityCard";
import { LeakSeverityGauge } from "../components/charts/LeakSeverityGauge";

// ── Icon map ────────────────────────────────────────────────────────────────
const ICONS = {
    stability: "stability",
    mask_fit: "mask_fit",
    compliance: "compliance",
    outlier: "outlier",
    default: "default",
};

const KEY_COLOR = {
    stability: { border: "#22D3EE", bg: "rgba(34,211,238,0.08)" },
    mask_fit: { border: "#10b981", bg: "rgba(16,185,129,0.08)" },
    compliance: { border: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
    outlier: { border: "#ef4444", bg: "rgba(239,68,68,0.08)" },
    default: { border: "#4F46E5", bg: "rgba(79,70,229,0.08)" },
};

function AppIcon({ type = "default", color = "var(--muted)", size = 18 }) {
    const common = {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: color,
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        'aria-hidden': true,
    };

    if (type === "stability") return <svg {...common}><path d="M3 12h3l2-5 4 10 2-5h7" /></svg>;
    if (type === "mask_fit") return <svg {...common}><path d="M7 4h10l1 5v4a6 6 0 0 1-12 0V9l1-5z" /><path d="M10 12h4" /></svg>;
    if (type === "compliance") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
    if (type === "outlier") return <svg {...common}><path d="M12 3 3 20h18L12 3z" /><path d="M12 9v5" /><path d="M12 17h.01" /></svg>;
    return <svg {...common}><path d="M4 19h16" /><path d="M6 15l4-4 3 3 5-6" /></svg>;
}

function CorrelationBar({ r, pair, label }) {
    const [hovered, setHovered] = useState(false);
    const MathAlias = Math; // To pacify strict eslint
    const pct = MathAlias.abs(r) * 100;
    const color = r > 0.4 ? "#22D3EE" : r < -0.4 ? "#ef4444" : "var(--muted)";
    const positive = r >= 0;
    const tooltipText = getCorrelationInsight(pair, r);
    const absR = MathAlias.abs(r);
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
            <div style={{ background: "var(--card-inner)", borderRadius: 4, height: 6, position: "relative" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "var(--separator)" }} />
                <div style={{
                    position: "absolute", height: "100%", width: `${pct / 2}%`, borderRadius: 4, background: color,
                    left: positive ? "50%" : `calc(50% - ${pct / 2}%)`,
                }} />
            </div>
            <div style={{ marginTop: 6, fontSize: "0.75rem", color: "var(--muted)" }}>{label || "Weak correlation"}</div>
            {hovered && (
                <div style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 50,
                    background: 'var(--bg)', border: '1px solid rgba(79,70,229,0.4)', borderRadius: 8,
                    padding: '12px 14px', fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.7,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.5)', pointerEvents: 'none'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, color: '#22D3EE', fontSize: '0.8rem' }}>Clinical Interpretation</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text)', fontWeight: 700 }}>r = {Number(r).toFixed(2)} — {strength.label}</span>
                    </div>
                    {tooltipText}
                </div>
            )}
        </div>
    );
}

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
            <span
                style={{
                    width: 30, height: 30, borderRadius: 6, display: "inline-flex",
                    alignItems: "center", justifyContent: "center",
                    background: "var(--card-inner)", border: `1px solid ${theme.border}`, flexShrink: 0
                }}
            >
                <AppIcon type={icon} color={theme.border} size={18} />
            </span>
            <div>
                <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>{insight.title}</div>
                <div style={{ color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1.5 }}>{insight.summary}</div>
            </div>
        </div>
    );
}

export function Insights({ range = "30", customFrom = "", customTo = "" }) {
    const [data, setData] = useState(null);

    const loadData = async () => {
        let payload;
        if (range === "custom") payload = { from: customFrom, to: customTo };
        else if (range === "all") payload = { days: 0 };
        else payload = { days: parseInt(range, 10) };
        const res = await window.cpapAPI.getInsights(payload);
        if (res) setData(res);
    };

    useEffect(() => {
        setData(null);
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
    const seenKeys = new Set();
    const uniqueExplanations = (explanations || []).filter(exp => {
        if (seenKeys.has(exp.key)) return false;
        seenKeys.add(exp.key);
        return true;
    });

    const sorted = [...(trends || [])].reverse();
    const analyzed = filterAnalyzedDays(sorted);
    const labels = sorted.map(d => d.night_date?.slice(5));
    const ahiData = sorted.map(d => d.ahi_total || 0);

    let burden = null;
    const lastWithBurden = (trends || []).find(t => t.residual_burden);
    if (lastWithBurden) {
        try { burden = JSON.parse(lastWithBurden.residual_burden); } catch (_) { }
    }

    const totalNights = analyzed.length;
    const rangeLabel = range === 'all' ? 'All Time' : range === 'custom' ? 'Custom Range' : `Last ${range} Days`;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {analyzed.length > 0 && (() => {
                const avg = (fn) => {
                    const vals = analyzed
                        .map(fn)
                        .map((value) => toMetricNumber(value))
                        .filter((value) => value !== null && value >= 0);
                    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                };
                const avgAhi = avg(d => d.ahi_total);
                const avgUsage = avg(d => d.usage_hours);
                const avgPress = avg(d => d.pressure_median);
                const avgLeak50 = avg(d => d.leak_p50);
                const avgFlow = avg(d => d.minute_vent_p50);
                const metricSummary = data.metricSummary || {
                    leak: calculatePercentile(analyzed.map((day) => day.leak_p95), 0.95),
                    tidalVolume: calculatePercentile(analyzed.map((day) => day.tidal_vol_p50), 0.5)
                };
                const displayLeak95 = toMetricNumber(metricSummary.leak);
                const displayTidal = toMetricNumber(metricSummary.tidalVolume);

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
                    <>
                        <section className="panel" style={{ padding: 20 }}>
                            <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                {rangeLabel} Averages
                            </h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                                <StatCard label="Average AHI" value={formatMetricValue(avgAhi, 1)} unit="events/hr" sub={rangeLabel} color="#ef4444" />
                                <StatCard label="Average Usage" value={formatMetricValue(avgUsage, 1)} unit="hours" sub="per night" color="#10b981" />
                                <StatCard label="Average Pressure" value={formatMetricValue(avgPress, 1)} unit="cmH₂O" sub="50th percentile" color="#22D3EE" />
                                <div style={{ gridRow: "span 2", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px" }}>
                                    <div style={{ fontSize: "0.65rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, textAlign: "center", marginBottom: 10 }}>Average Mask Leak</div>
                                    <LeakSeverityGauge leak50={avgLeak50} leak95={displayLeak95} height={180} />
                                </div>
                                <StatCard label="Average Flow" value={formatMetricValue(avgFlow, 1)} unit="L/min" sub="50th percentile" color="#8b5cf6" />
                                <StatCard label="Average Vol." value={formatMetricValue(displayTidal, 0)} unit="mL" sub="50th percentile" color="#22D3EE" />
                                <StatCard label="Nights Analyzed" value={analyzed.length} unit="" sub="excluding no-data" color="#8b5cf6" />
                            </div>
                        </section>

                        <section className="panel" style={{ padding: 20 }}>
                            <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                AHI Trend ({rangeLabel})
                            </h3>
                            <AHITrendChart labels={labels} data={ahiData} height={220} />
                        </section>
                    </>
                );
            })()}

            {uniqueExplanations.length > 0 && (
                <section className="panel" style={{ padding: 20 }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <AppIcon type="default" color="var(--muted)" size={16} />
                        Recent Findings
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {uniqueExplanations.map((exp, i) => <InsightCard key={i} insight={exp} />)}
                    </div>
                </section>
            )}

            <TherapyStabilityCard burden={burden} totalNights={totalNights} rangeLabel={rangeLabel} />

            <section className="panel" style={{ padding: 20 }}>
                <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 8 }}>
                    <AppIcon type="default" color="var(--muted)" size={16} />
                    Metric Correlations ({rangeLabel})
                </h3>
                {correlations && correlations.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {correlations.map((c, i) => (
                            <CorrelationBar key={i} pair={`${c.x} ↔ ${c.y}`} r={c.r} label={c.label} />
                        ))}
                    </div>
                ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)", padding: "20px 0" }}>
                        <AppIcon type="default" color="var(--muted)" size={18} />
                        <span>Not enough data for correlations. Requires at least 2 nights of recorded sessions.</span>
                    </div>
                )}
            </section>
        </div>
    );
}
