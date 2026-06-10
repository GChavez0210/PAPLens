import { memo, useMemo, useState } from "react";

const TOOLTIP = {
    title: "What this means",
    what: "Periodic breathing (PB) is a cyclic pattern where breathing alternates between deep breaths and shallow breaths or brief pauses, typically with a 30–120 second cycle. When it occurs during sleep, especially with central apneas at the nadir, it is called Cheyne-Stokes respiration (CSR) — a pattern associated with heart failure, stroke, and high-altitude exposure.",
    action: "PB above 5% of recording time is considered clinically significant. If flagged, share this finding with your cardiologist or sleep physician. CSR can often be addressed by optimizing CPAP pressure, switching to adaptive servo-ventilation (ASV), or treating the underlying cardiac condition."
};

function formatDuration(totalSeconds) {
    if (totalSeconds == null) return "—";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function PeriodicBreathingCardComponent({ trends }) {
    const [hovered, setHovered] = useState(false);
    const nights = useMemo(() => (trends || []).filter(r => r.pb_pct != null), [trends]);

    if (!trends || trends.length === 0) return null;

    // Aggregate PB stats across the selected date range
    if (nights.length === 0) return null;

    const significantNights = nights.filter(r => r.pb_is_significant === 1);
    const anySignificant = significantNights.length > 0;
    const confoundedNights = nights.filter(r => r.pb_leak_confounded === 1);
    const majorityConfounded = confoundedNights.length > significantNights.length / 2;
    const avgPbPct = nights.reduce((sum, r) => sum + (r.pb_pct ?? 0), 0) / nights.length;
    const totalEpisodes = nights.reduce((sum, r) => sum + (r.pb_episode_count ?? 0), 0);
    const totalPBSec = nights.reduce((sum, r) => sum + (r.pb_total_seconds ?? 0), 0);

    const cycleSecs = nights.map(r => r.pb_avg_cycle_sec).filter(v => v != null && v > 0);
    const avgCycle = cycleSecs.length > 0
        ? Math.round(cycleSecs.reduce((a, b) => a + b, 0) / cycleSecs.length)
        : null;

    const hasPB = avgPbPct > 0;

    const borderColor = anySignificant
        ? (majorityConfounded ? "#a78bfa" : "#f59e0b")
        : hasPB ? "#22D3EE" : "#374151";
    const bgColor = anySignificant
        ? (majorityConfounded ? "rgba(167,139,250,0.07)" : "rgba(245,158,11,0.07)")
        : hasPB ? "rgba(34,211,238,0.06)" : "var(--card)";
    const badgeColor = anySignificant
        ? (majorityConfounded ? "#a78bfa" : "#f59e0b")
        : hasPB ? "#22D3EE" : "#6b7280";
    const badgeBg = anySignificant
        ? (majorityConfounded ? "rgba(167,139,250,0.15)" : "rgba(245,158,11,0.15)")
        : hasPB ? "rgba(34,211,238,0.12)" : "rgba(107,114,128,0.12)";
    const badgeLabel = anySignificant
        ? (majorityConfounded ? "? Possibly Significant" : "⚠ Clinically Significant")
        : hasPB ? "Detected" : "None";

    return (
        <div
            style={{
                background: bgColor,
                border: `1px solid ${borderColor}`,
                borderLeft: `4px solid ${borderColor}`,
                borderRadius: 10,
                padding: "18px 20px",
                position: "relative",
                cursor: "help"
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={borderColor}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M2 12c1-4 3-6 5-6s3.5 3 5 6 3 6 5 6 4-2 5-6" />
                    </svg>
                    <span style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--text)" }}>
                        Periodic Breathing
                    </span>
                </div>
                <span style={{
                    fontSize: "0.7rem", fontWeight: 700, color: badgeColor,
                    background: badgeBg, borderRadius: 5, padding: "3px 8px",
                    letterSpacing: "0.03em"
                }}>
                    {badgeLabel}
                </span>
            </div>

            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <StatCell label="Avg PB%" value={hasPB ? `${avgPbPct.toFixed(1)}%` : "0%"} accent={borderColor} />
                <StatCell label="Episodes" value={hasPB ? totalEpisodes : "0"} accent={borderColor} />
                <StatCell label="Total PB Time" value={hasPB ? formatDuration(totalPBSec) : "—"} accent={borderColor} />
                <StatCell label="Avg Cycle" value={avgCycle ? `${avgCycle}s` : "—"} accent={borderColor} />
            </div>

            {/* PB% bar */}
            {hasPB && (
                <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--muted)", marginBottom: 4 }}>
                        <span>PB% across selected range</span>
                        <span style={{ fontWeight: 700, color: borderColor }}>{avgPbPct.toFixed(1)}%</span>
                    </div>
                    <div style={{ background: "var(--card-inner)", borderRadius: 4, height: 6 }}>
                        <div style={{
                            height: "100%", borderRadius: 4, background: borderColor,
                            width: `${Math.min(100, avgPbPct * 5)}%`,
                            transition: "width 0.4s ease"
                        }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "var(--muted)", marginTop: 3 }}>
                        <span>0%</span>
                        <span style={{ color: "#f59e0b" }}>5% threshold</span>
                        <span>20%+</span>
                    </div>
                    {/* Threshold marker at 5% (= 25% of bar width since bar is ×5) */}
                    <div style={{ position: "relative", height: 0 }}>
                        <div style={{
                            position: "absolute", top: -10, left: "25%",
                            width: 1, height: 10, background: "#f59e0b60"
                        }} />
                    </div>
                </div>
            )}

            {anySignificant && (
                <div style={{
                    marginTop: 12, padding: "8px 12px", borderRadius: 6,
                    background: majorityConfounded ? "rgba(167,139,250,0.10)" : "rgba(245,158,11,0.12)",
                    border: `1px solid ${majorityConfounded ? "rgba(167,139,250,0.3)" : "rgba(245,158,11,0.3)"}`,
                    fontSize: "0.78rem", color: borderColor, lineHeight: 1.5
                }}>
                    {majorityConfounded
                        ? <><strong>Low confidence:</strong> {significantNights.length} night{significantNights.length !== 1 ? "s" : ""} met the ≥5% threshold, but most episodes coincided with mask leak events — these may be arousal-driven rather than true periodic breathing. Mention to your care team if leak issues are recurring.</>
                        : <><strong>Clinical flag:</strong> {significantNights.length} night{significantNights.length !== 1 ? "s" : ""} met the ≥5% periodic breathing threshold. Discuss with your sleep physician or cardiologist.</>
                    }
                </div>
            )}

            {/* Hover tooltip */}
            {hovered && (
                <div style={{
                    position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0, zIndex: 50,
                    background: "var(--card)", border: `1px solid ${borderColor}`, borderRadius: 10,
                    padding: "14px 16px", fontSize: "0.78rem", color: "var(--text)", lineHeight: 1.7,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.55)", pointerEvents: "none"
                }}>
                    <div style={{ fontWeight: 700, color: borderColor, fontSize: "0.82rem", marginBottom: 8 }}>
                        {TOOLTIP.title}
                    </div>
                    <div style={{ color: "var(--muted)", marginBottom: 10 }}>{TOOLTIP.what}</div>
                    <div style={{ borderTop: `1px solid ${borderColor}40`, paddingTop: 8 }}>
                        <span style={{ fontWeight: 700, color: borderColor, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: 1 }}>
                            How to address
                        </span>
                        <div style={{ color: "var(--text)", marginTop: 4 }}>{TOOLTIP.action}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

export const PeriodicBreathingCard = memo(PeriodicBreathingCardComponent);

function StatCell({ label, value, accent }) {
    return (
        <div style={{
            background: "var(--card-inner)", borderRadius: 7, padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 3
        }}>
            <span style={{ fontSize: "0.68rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {label}
            </span>
            <span style={{ fontSize: "1.05rem", fontWeight: 700, color: accent }}>
                {value}
            </span>
        </div>
    );
}
