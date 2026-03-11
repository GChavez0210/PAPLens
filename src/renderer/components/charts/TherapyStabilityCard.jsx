import React from "react";

function BurdenStat({ value, total, label, color }) {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: 6 }}>{label}</div>
            <div style={{ background: "var(--card-inner)", borderRadius: 4, height: 4, width: "80%", margin: "0 auto" }}>
                <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4, transition: "width 0.8s" }} />
            </div>
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: 4 }}>{pct}% of nights</div>
        </div>
    );
}

function Ahi95Stat({ value }) {
    const pctOfTarget = Math.min(100, Math.round((value / 5) * 100));
    return (
        <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "#22D3EE" }}>{Number(value || 0).toFixed(1)}</div>
            <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginBottom: 6 }}>AHI 95th Percentile</div>
            <div style={{ background: "var(--card-inner)", borderRadius: 4, height: 4, width: "80%", margin: "0 auto" }}>
                <div style={{ width: `${pctOfTarget}%`, background: "#22D3EE", height: "100%", borderRadius: 4, transition: "width 0.8s" }} />
            </div>
            <div style={{ fontSize: "0.65rem", color: "#9ca3af", marginTop: 4 }}>events / hr</div>
        </div>
    );
}

export function TherapyStabilityCard({ burden, totalNights, rangeLabel }) {
    if (!burden || totalNights === 0) return null;

    return (
        <section className="panel" style={{ padding: 20 }}>
            <h3 style={{ margin: "0 0 20px 0", fontSize: "1rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h3l2-5 4 10 2-5h7" /></svg>
                Residual Burden — {rangeLabel}
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                <BurdenStat value={burden.nights_over_5 ?? 0} total={totalNights} label="Nights AHI > 5" color="#f59e0b" />
                <BurdenStat value={burden.nights_over_10 ?? 0} total={totalNights} label="Nights AHI > 10" color="#ef4444" />
                <Ahi95Stat value={burden.AHI_p95_30} />
            </div>
        </section>
    );
}
