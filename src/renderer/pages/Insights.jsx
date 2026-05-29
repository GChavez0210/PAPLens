import { useCallback, useEffect, useState } from "react";
import { filterAnalyzedDays, getCorrelationInsight } from "../utils/reportBuilder";
import { calculatePercentile, formatMetricValue, toMetricNumber } from "../utils/therapyMetrics";
import { AHITrendChart } from "../components/charts/AHITrendChart";
import { TherapyStabilityCard } from "../components/charts/TherapyStabilityCard";
import { LeakSeverityGauge } from "../components/charts/LeakSeverityGauge";
import { EventTypeSplitChart } from "../components/charts/EventTypeSplitChart";
import { FlowLimitationChart } from "../components/charts/FlowLimitationChart";
import { PressureHistogramChart } from "../components/charts/PressureHistogramChart";
import { PeriodicBreathingCard } from "../components/charts/PeriodicBreathingCard";

const KEY_COLOR = {
    stability: { border: "#22D3EE", bg: "rgba(34,211,238,0.08)" },
    mask_fit: { border: "#10b981", bg: "rgba(16,185,129,0.08)" },
    compliance: { border: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
    outlier: { border: "#ef4444", bg: "rgba(239,68,68,0.08)" },
    periodic_breathing: { border: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
    flow_limitation: { border: "#f59e0b", bg: "rgba(245,158,11,0.08)" },
    default: { border: "#4F46E5", bg: "rgba(79,70,229,0.08)" },
};

// ── Hover tooltip content for each insight type ─────────────────────────────
const INSIGHT_TOOLTIPS = {
    stability: {
        title: "What this means",
        what: "Therapy stability measures how consistent your breathing patterns and pressure delivery were across the night. High variance can signal unresolved obstruction, positional changes, or mask issues affecting how well your device adapts.",
        action: "Check your sleep position and mask fit. If events cluster in the second half of the night, consider positional therapy aids or review your pressure settings with your care team."
    },
    mask_fit: {
        title: "What this means",
        what: "High leak rates reduce the effective pressure delivered to your airway, potentially allowing breathing events to go unresolved. Large leaks also disrupt your device's auto-titration algorithm, causing it to escalate pressure unnecessarily.",
        action: "Inspect the mask cushion for wear and clean the seal surface. Re-adjust headgear tension — it should be snug but not tight. If leaks persist across multiple nights, consider a mask fitting session or a different mask style."
    },
    compliance: {
        title: "What this means",
        what: "Insurance and clinical guidelines typically require 4+ hours of use on at least 70% of nights to classify therapy as \"compliant.\" Consistent use is critical — benefits like blood pressure reduction and daytime alertness depend on regular nightly therapy.",
        action: "Set a consistent sleep schedule and address comfort barriers: pressure ramp settings, heated humidifier, a chin strap for mouth breathing, or a different mask interface can all significantly improve adherence."
    },
    outlier: {
        title: "What this means",
        what: "This night's metrics deviated significantly from your recent baseline using statistical z-score analysis. Outliers can reflect a genuine acute issue (illness, alcohol, new sleep position) or simply natural night-to-night variability.",
        action: "Review the specific metrics flagged. Isolated outliers rarely require action — watch for a pattern across multiple nights before adjusting therapy. If outliers occur frequently, discuss with your healthcare provider."
    },
    periodic_breathing: {
        title: "What this means",
        what: "Periodic breathing is a cyclic pattern where tidal volume alternates between deep and shallow breaths over a 30–120 second cycle. When accompanied by central apneas at the nadir it is called Cheyne-Stokes respiration — a pattern linked to heart failure, stroke, and altitude sickness.",
        action: "If this is flagged repeatedly, share the finding with your cardiologist or sleep physician. Adaptive servo-ventilation (ASV) or treating the underlying cardiac condition can significantly reduce CSR events."
    },
    flow_limitation: {
        title: "What this means",
        what: "Flow limitation occurs when your upper airway narrows enough to reduce airflow without a complete collapse. Your CPAP device records a 0–1 index per breath: values above 0.10 indicate mild narrowing, above 0.30 is clinically significant. The Respiratory Disturbance Index (RIN) counts flow-limited breaths that don't reach apnea or hypopnea severity but can still fragment sleep.",
        action: "If FL P95 is persistently above 0.30, discuss widening your pressure range or switching to an AutoPAP mode with your care team. Mild elevation (0.10–0.30) may respond to positional therapy or mask adjustments."
    },
    default: {
        title: "What this means",
        what: "This observation was flagged based on analysis of your recent therapy data and clinical thresholds.",
        action: "Review the details and discuss with your healthcare provider if the pattern persists across multiple nights."
    }
};

// ── Hover tooltip content for each stat metric ─────────────────────────────
const STAT_TOOLTIPS = {
    ahi: {
        title: "Apnea-Hypopnea Index (AHI)",
        what: "Average number of breathing pauses (apneas) and near-pauses (hypopneas) per hour of sleep. This is the primary measure of how well your therapy is controlling your sleep apnea.",
        impact: "Under 5 is normal; 5–15 mild; 15–30 moderate; above 30 is severe. Consistently elevated AHI means your airway is not staying open effectively."
    },
    usage: {
        title: "Nightly Therapy Usage",
        what: "Average hours per night the CPAP device was actively running across the selected date range.",
        impact: "4+ hours/night is the clinical compliance minimum. More consistent use directly correlates with better health outcomes — daytime alertness, blood pressure, and cardiovascular risk all improve with regular therapy."
    },
    pressure: {
        title: "Delivered Pressure (P50)",
        what: "The median air pressure in cmH₂O that your device delivered to keep your airway open. The 50th percentile excludes brief spikes, giving a representative picture of typical nighttime pressure.",
        impact: "Higher than your prescribed minimum may signal unresolved events driving the device up. Consistently near your max setting suggests your pressure range may need widening."
    },
    flow: {
        title: "Minute Ventilation (MV P50)",
        what: "Total volume of air exchanged per minute, combining breathing rate and tidal volume depth. Reflects how effectively your lungs are ventilating during therapy.",
        impact: "Stable ventilation confirms effective breathing support. Drops in MV alongside rising AHI may indicate central events or flow limitation not fully addressed by pressure alone."
    },
    tidal: {
        title: "Tidal Volume (P50)",
        what: "Average volume of air moved per breath, in milliliters. Measured as the 50th percentile from high-resolution session data.",
        impact: "Normal adult tidal volume is roughly 400–600 mL. Consistently low values may indicate shallow breathing, significant air leak reducing delivered volume, or mask sizing issues."
    },
    nights: {
        title: "Nights Analyzed",
        what: "Count of nights with sufficient therapy data (usage hours > 0) within the selected date range. Nights with no recorded usage are excluded from all averages.",
        impact: "More nights = more reliable statistical averages. Short ranges (under 7 nights) may show misleading averages due to natural night-to-night variability."
    }
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

    if (type === "periodic_breathing") return <svg {...common}><path d="M2 12c1-4 3-6 5-6s3.5 3 5 6 3 6 5 6 4-2 5-6" /></svg>;
    if (type === "flow_limitation") return <svg {...common}><path d="M3 12h4l2-4 3 8 2-4h7" /><path d="M3 17h18" strokeDasharray="3 2" /></svg>;
    if (type === "stability") return <svg {...common}><path d="M3 12h3l2-5 4 10 2-5h7" /></svg>;
    if (type === "mask_fit") return <svg {...common}><path d="M7 4h10l1 5v4a6 6 0 0 1-12 0V9l1-5z" /><path d="M10 12h4" /></svg>;
    if (type === "compliance") return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>;
    if (type === "outlier") return <svg {...common}><path d="M12 3 3 20h18L12 3z" /><path d="M12 9v5" /><path d="M12 17h.01" /></svg>;
    return <svg {...common}><path d="M4 19h16" /><path d="M6 15l4-4 3 3 5-6" /></svg>;
}

function CorrelationBar({ r, pair, label }) {
    const [hovered, setHovered] = useState(false);
    const pct = Math.abs(r) * 100;
    const color = r > 0.4 ? "#22D3EE" : r < -0.4 ? "#ef4444" : "var(--muted)";
    const positive = r >= 0;
    const tooltipText = getCorrelationInsight(pair, r);
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
    const [hovered, setHovered] = useState(false);
    const theme = KEY_COLOR[insight.key] || KEY_COLOR.default;
    const icon = insight.key in KEY_COLOR ? insight.key : "default";
    const tooltip = INSIGHT_TOOLTIPS[insight.key] || INSIGHT_TOOLTIPS.default;

    return (
        <div
            style={{
                display: "flex", gap: 14, padding: "14px 16px",
                background: theme.bg, border: `1px solid ${theme.border}`,
                borderLeft: `4px solid ${theme.border}`,
                borderRadius: 8, alignItems: "flex-start",
                position: 'relative', cursor: 'help'
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
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
            {hovered && (
                <div style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 50,
                    background: 'var(--card)', border: `1px solid ${theme.border}`, borderRadius: 10,
                    padding: '14px 16px', fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.7,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.55)', pointerEvents: 'none'
                }}>
                    <div style={{ fontWeight: 700, color: theme.border, fontSize: '0.82rem', marginBottom: 8 }}>
                        {tooltip.title}
                    </div>
                    <div style={{ color: 'var(--muted)', marginBottom: 10 }}>{tooltip.what}</div>
                    <div style={{ borderTop: `1px solid ${theme.border}40`, paddingTop: 8 }}>
                        <span style={{ fontWeight: 700, color: theme.border, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                            How to address
                        </span>
                        <div style={{ color: 'var(--text)', marginTop: 4 }}>{tooltip.action}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

const MULTI_NIGHT_TITLES = {
    "Significant Flow Limitation": "Significant Flow Limitation Detected",
    "Mild Flow Limitation": "Mild Flow Limitation Observed",
    "Elevated Respiratory Disturbance": "Elevated Respiratory Disturbance Observed",
    "Stable Night": "Generally Stable",
    "Fluctuating Therapy": "Inconsistent Therapy Detected",
    "Unusual Night Detected": "Unusual Nights Detected",
    "Elevated Event Count": "Elevated Event Count Detected",
    "Exceptionally Low AHI": "Consistently Low AHI",
    "Reduced Therapy Usage": "Reduced Therapy Usage Detected",
    "Extended Usage Night": "Extended Usage Observed",
    "Elevated Mask Leak": "Elevated Mask Leak Detected",
    "High Tidal Volume": "High Tidal Volume Observed",
    "Low Tidal Volume": "Low Tidal Volume Observed",
    "Elevated Breathing Volume": "Elevated Breathing Volume Observed",
    "Reduced Breathing Volume": "Reduced Breathing Volume Observed",
};

function adaptForRange(exp) {
    const title = MULTI_NIGHT_TITLES[exp.title] ?? exp.title;
    const summary = (exp.summary || "")
        .replace(/^This night stood out because/, "Some nights stood out because")
        .replace(/^This night/, "Some nights");
    return { ...exp, title, summary };
}

export function Insights({ range = "30", customFrom = "", customTo = "" }) {
    const [data, setData] = useState(null);

    const loadData = useCallback(async () => {
        let payload;
        if (range === "custom") payload = { from: customFrom, to: customTo };
        else if (range === "all") payload = { days: 0 };
        else payload = { days: parseInt(range, 10) };
        try {
            const res = await window.cpapAPI.getInsights(payload);
            if (res) setData(res);
            else setData({});
        } catch (err) {
            console.error("Failed to load insights", err);
            setData({});
        }
    }, [customFrom, customTo, range]);

    useEffect(() => {
        setData(null);
        loadData();
        const unsub = window.cpapAPI.onDataLoaded(() => loadData());
        return () => unsub();
    }, [loadData]);

    if (data === null) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#9ca3af" }}>
            <span style={{ fontSize: "1.2rem" }}>Loading insights...</span>
        </div>
    );

    const { trends, correlations, explanations, complianceRate, complianceWindowNights, compliantNights } = data;
    const seenKeys = new Set();
    const uniqueExplanations = (explanations || []).filter(exp => {
        if (seenKeys.has(exp.key)) return false;
        seenKeys.add(exp.key);
        return true;
    }).map(adaptForRange);

    const sorted = [...(trends || [])].reverse();
    const analyzed = filterAnalyzedDays(sorted);
    const labels = sorted.map(d => d.night_date?.slice(5));
    const ahiData = sorted.map(d => d.ahi_total || 0);

    let burden = null;
    const lastWithBurden = (trends || []).find(t => t.residual_burden);
    if (lastWithBurden) {
        try {
            burden = JSON.parse(lastWithBurden.residual_burden);
        } catch {
            burden = null;
        }
    }

    const totalNights = analyzed.length;
    const rangeLabel = range === 'all' ? 'All Time' : range === 'custom' ? 'Custom Range' : `Last ${range} Days`;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {analyzed.length > 0 && (() => {
                // positiveOnly=true excludes stored zeros for metrics where 0 = "no data"
                const avg = (fn, positiveOnly = false) => {
                    const vals = analyzed
                        .map(fn)
                        .map((value) => toMetricNumber(value))
                        .filter((value) => value !== null && (positiveOnly ? value > 0 : value >= 0));
                    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                };
                const avgAhi = avg(d => d.ahi_total);          // 0 is valid (great night)
                const avgUsage = avg(d => d.usage_hours);       // 0 would be filtered by filterAnalyzedDays already
                const avgPress = avg(d => d.pressure_median, true);  // 0 = no data sentinel
                const avgLeak50 = avg(d => d.leak_p50, true);        // 0 = no data sentinel
                const avgFlow = avg(d => d.minute_vent_p50, true);   // 0 = no data sentinel
                const metricSummary = data.metricSummary || {
                    leak: calculatePercentile(analyzed.map((day) => day.leak_p95), 0.95),
                    tidalVolume: calculatePercentile(analyzed.map((day) => day.tidal_vol_p50), 0.5)
                };
                const displayLeak95 = toMetricNumber(metricSummary.leak);
                const displayTidal = toMetricNumber(metricSummary.tidalVolume);

                const StatCard = ({ label, value, unit, sub, color = "#22D3EE", tooltipKey, tooltipDown = false }) => {
                    const [hovered, setHovered] = useState(false);
                    const tip = tooltipKey ? STAT_TOOLTIPS[tooltipKey] : null;
                    const tipPos = tooltipDown
                        ? { top: 'calc(100% + 8px)' }
                        : { bottom: 'calc(100% + 8px)' };

                    return (
                        <div
                            style={{
                                background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8,
                                padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4,
                                position: 'relative', cursor: tip ? 'help' : 'default'
                            }}
                            onMouseEnter={() => tip && setHovered(true)}
                            onMouseLeave={() => tip && setHovered(false)}
                        >
                            <div style={{ fontSize: "0.65rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                                <span style={{ fontSize: "1.8rem", fontWeight: 800, color, lineHeight: 1 }}>{value}</span>
                                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{unit}</span>
                            </div>
                            {sub && <div style={{ fontSize: "0.65rem", color: "#6b7280" }}>{sub}</div>}
                            {hovered && tip && (
                                <div style={{
                                    position: 'absolute', ...tipPos, left: 0, right: 0, zIndex: 50,
                                    background: 'var(--card)', border: `1px solid ${color}60`, borderRadius: 10,
                                    padding: '14px 16px', fontSize: '0.78rem', color: 'var(--text)', lineHeight: 1.7,
                                    boxShadow: '0 12px 40px rgba(0,0,0,0.55)', pointerEvents: 'none', minWidth: 240
                                }}>
                                    <div style={{ fontWeight: 700, color, fontSize: '0.82rem', marginBottom: 8 }}>
                                        {tip.title}
                                    </div>
                                    <div style={{ color: 'var(--muted)', marginBottom: 10 }}>{tip.what}</div>
                                    <div style={{ borderTop: `1px solid ${color}30`, paddingTop: 8 }}>
                                        <span style={{ fontWeight: 700, color, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                                            Therapy impact
                                        </span>
                                        <div style={{ color: 'var(--text)', marginTop: 4 }}>{tip.impact}</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                };

                return (
                    <>
                        <section className="panel" style={{ padding: 20 }}>
                            <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                {rangeLabel} Averages
                            </h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                                <StatCard label="Average AHI" value={formatMetricValue(avgAhi, 1)} unit="events/hr" sub={rangeLabel} color="#ef4444" tooltipKey="ahi" tooltipDown />
                                <StatCard label="Average Usage" value={formatMetricValue(avgUsage, 1)} unit="hours" sub="per night" color="#10b981" tooltipKey="usage" tooltipDown />
                                <StatCard label="Average Pressure" value={formatMetricValue(avgPress, 1)} unit="cmH₂O" sub="50th percentile" color="#22D3EE" tooltipKey="pressure" tooltipDown />
                                <div style={{ gridRow: "span 2", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px" }}>
                                    <div style={{ fontSize: "0.65rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, textAlign: "center", marginBottom: 10 }}>Average Mask Leak</div>
                                    <LeakSeverityGauge leak50={avgLeak50} leak95={displayLeak95} height={180} />
                                </div>
                                <StatCard label="Average Flow" value={formatMetricValue(avgFlow, 1)} unit="L/min" sub="50th percentile" color="#8b5cf6" tooltipKey="flow" />
                                <StatCard label="Average Vol." value={formatMetricValue(displayTidal, 0)} unit="mL" sub="50th percentile" color="#22D3EE" tooltipKey="tidal" />
                                <StatCard label="Nights Analyzed" value={analyzed.length} unit="" sub="excluding no-data" color="#8b5cf6" tooltipKey="nights" />
                            </div>
                        </section>

                        <section className="panel" style={{ padding: 20 }}>
                            <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                AHI Trend ({rangeLabel})
                            </h3>
                            <div data-report-key="ahi-trend">
                                <AHITrendChart labels={labels} data={ahiData} height={220} />
                            </div>
                        </section>

                        {(() => {
                            // Weekend vs weekday AHI and usage comparison
                            const weekendDays = analyzed.filter(d => { const dow = new Date(d.night_date).getDay(); return dow === 0 || dow === 6; });
                            const weekdayDays = analyzed.filter(d => { const dow = new Date(d.night_date).getDay(); return dow >= 1 && dow <= 5; });
                            const wkndAhi = weekendDays.length > 0 ? weekendDays.reduce((a, d) => a + (d.ahi_total || 0), 0) / weekendDays.length : null;
                            const wkdyAhi = weekdayDays.length > 0 ? weekdayDays.reduce((a, d) => a + (d.ahi_total || 0), 0) / weekdayDays.length : null;
                            const wkndUsage = weekendDays.length > 0 ? weekendDays.reduce((a, d) => a + (d.usage_hours || 0), 0) / weekendDays.length : null;
                            const wkdyUsage = weekdayDays.length > 0 ? weekdayDays.reduce((a, d) => a + (d.usage_hours || 0), 0) / weekdayDays.length : null;
                            if (wkndAhi === null && wkdyAhi === null) return null;

                            const compColor = complianceRate === null ? "#6b7280"
                                : complianceRate >= 70 ? "#10b981"
                                : complianceRate >= 50 ? "#f59e0b" : "#ef4444";

                            return (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                                    {/* Compliance rate */}
                                    {complianceRate !== null && (
                                        <section className="panel" style={{ padding: 20 }}>
                                            <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                                30-Day Compliance Rate
                                            </h3>
                                            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                                                <div style={{ textAlign: "center" }}>
                                                    <div style={{ fontSize: "3rem", fontWeight: 800, color: compColor, lineHeight: 1 }}>{complianceRate}%</div>
                                                    <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: 4 }}>nights ≥ 4 hrs</div>
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ background: "var(--card-inner)", borderRadius: 6, height: 10 }}>
                                                        <div style={{ width: `${complianceRate}%`, background: compColor, height: "100%", borderRadius: 6, transition: "width 0.8s" }} />
                                                    </div>
                                                    <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 8 }}>
                                                        {compliantNights} of {complianceWindowNights} nights qualify
                                                    </div>
                                                    <div style={{ fontSize: "0.7rem", color: complianceRate >= 70 ? "#10b981" : "#f59e0b", marginTop: 4 }}>
                                                        {complianceRate >= 70 ? "Insurance compliance threshold met" : "Below 70% CMS compliance threshold"}
                                                    </div>
                                                </div>
                                            </div>
                                        </section>
                                    )}

                                    {/* Weekend vs weekday */}
                                    <section className="panel" style={{ padding: 20 }}>
                                        <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                            Weekend vs Weekday
                                        </h3>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                            {[
                                                { label: "AHI", wkdy: wkdyAhi, wknd: wkndAhi, unit: "events/hr", color: "#ef4444" },
                                                { label: "Usage", wkdy: wkdyUsage, wknd: wkndUsage, unit: "hrs", color: "#10b981" }
                                            ].map(({ label, wkdy, wknd, unit, color }) => {
                                                const delta = wkdy !== null && wknd !== null ? wknd - wkdy : null;
                                                return (
                                                    <div key={label} style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 14px" }}>
                                                        <div style={{ fontSize: "0.65rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{label}</div>
                                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                                            <div>
                                                                <div style={{ fontSize: "0.65rem", color: "#6b7280" }}>Weekday</div>
                                                                <div style={{ fontSize: "1.2rem", fontWeight: 700, color }}>{wkdy !== null ? wkdy.toFixed(1) : "—"}</div>
                                                            </div>
                                                            <div style={{ textAlign: "right" }}>
                                                                <div style={{ fontSize: "0.65rem", color: "#6b7280" }}>Weekend</div>
                                                                <div style={{ fontSize: "1.2rem", fontWeight: 700, color }}>{wknd !== null ? wknd.toFixed(1) : "—"}</div>
                                                            </div>
                                                        </div>
                                                        {delta !== null && (
                                                            <div style={{ fontSize: "0.7rem", color: Math.abs(delta) < 0.3 ? "#6b7280" : "#f59e0b" }}>
                                                                Δ {delta > 0 ? "+" : ""}{delta.toFixed(1)} {unit} on weekends
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                </div>
                            );
                        })()}

                        {/* Event type split */}
                        {analyzed.some(d => (d.obstructive_apneas_per_hr ?? 0) + (d.central_apneas_per_hr ?? 0) + (d.hypopneas_per_hr ?? 0) > 0) && (
                            <section className="panel" style={{ padding: 20 }}>
                                <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                    Event Type Breakdown ({rangeLabel})
                                </h3>
                                <div data-report-key="event-split">
                    <EventTypeSplitChart trends={sorted} height={220} />
                </div>
                            </section>
                        )}

                        {/* Flow limitation & RIN */}
                        {analyzed.some(d => d.flow_limitation_p95 !== null && d.flow_limitation_p95 !== undefined) && (
                            <section className="panel" style={{ padding: 20 }}>
                                <h3 style={{ margin: "0 0 4px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                    Flow Limitation & Respiratory Disturbance ({rangeLabel})
                                </h3>
                                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 14 }}>
                                    FL P95 measures airway narrowing intensity; RIN counts flow-limited breaths that didn't score as events.
                                </div>
                                <div data-report-key="flow-limit">
                    <FlowLimitationChart trends={sorted} height={200} />
                </div>
                            </section>
                        )}

                        {/* Pressure distribution — averaged across all nights with histogram data */}
                        {(() => {
                            const histNights = sorted.filter(d => d.pressure_histogram);
                            if (histNights.length === 0) return null;

                            // Parse all available histograms
                            const parsed = histNights
                                .map(d => {
                                    try {
                                        return JSON.parse(d.pressure_histogram);
                                    } catch {
                                        return null;
                                    }
                                })
                                .filter(Boolean);
                            if (parsed.length === 0) return null;

                            // Average each bucket's pct across all nights
                            const bucketMap = {};
                            for (const hist of parsed) {
                                for (const b of hist) {
                                    const key = `${b.lo}-${b.hi}`;
                                    if (!bucketMap[key]) bucketMap[key] = { lo: b.lo, hi: b.hi, total: 0, count: 0 };
                                    bucketMap[key].total += b.pct;
                                    bucketMap[key].count += 1;
                                }
                            }
                            const avgHist = Object.values(bucketMap)
                                .sort((a, b) => a.lo - b.lo)
                                .map(b => ({ lo: b.lo, hi: b.hi, pct: b.total / b.count }));

                            // Average pressure efficiency across nights that have it
                            const effNights = histNights.filter(d => d.pressure_efficiency !== null && d.pressure_efficiency !== undefined);
                            const avgEff = effNights.length > 0
                                ? effNights.reduce((s, d) => s + d.pressure_efficiency, 0) / effNights.length
                                : null;

                            return (
                                <section className="panel" style={{ padding: 20 }}>
                                    <h3 style={{ margin: "0 0 4px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                                        Pressure Distribution ({rangeLabel})
                                    </h3>
                                    <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 14 }}>
                                        Average % of 2-second epochs at each pressure level across {parsed.length} night{parsed.length !== 1 ? "s" : ""} with high-resolution data.
                                        {avgEff !== null && ` Avg time near pressure ceiling: ${avgEff.toFixed(1)}%.`}
                                    </div>
                                    <PressureHistogramChart histogram={avgHist} height={200} />
                                </section>
                            );
                        })()}
                    </>
                );
            })()}

            {/* Periodic Breathing / Cheyne-Stokes analysis */}
            {trends && trends.some(r => r.pb_pct != null) && (
                <section className="panel" style={{ padding: 20 }}>
                    <h3 style={{ margin: "0 0 14px 0", fontSize: "1rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1 }}>
                        Periodic Breathing Analysis ({rangeLabel})
                    </h3>
                    <PeriodicBreathingCard trends={trends} />
                </section>
            )}

            {uniqueExplanations.length > 0 && (
                <section className="panel" style={{ padding: 20 }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: "1rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <AppIcon type="default" color="var(--muted)" size={16} />
                        Findings — {rangeLabel}
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {uniqueExplanations.map((exp) => <InsightCard key={`${exp.night_id}-${exp.key}`} insight={exp} />)}
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
                        {correlations.map((c) => (
                            <CorrelationBar key={`${c.x}-${c.y}`} pair={`${c.x} ↔ ${c.y}`} r={c.r} label={c.label} />
                        ))}
                    </div>
                ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)", padding: "20px 0" }}>
                        <AppIcon type="default" color="var(--muted)" size={16} />
                        <span>Not enough data for correlations. Requires at least 2 nights of recorded sessions.</span>
                    </div>
                )}
            </section>


        </div>
    );
}
