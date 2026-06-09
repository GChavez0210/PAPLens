import { memo, useState } from "react";

function TooltipWrap({ children, tip }) {
    const [hovered, setHovered] = useState(false);
    return (
        <div
            style={{ position: 'relative', cursor: 'help' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {children}
            {hovered && tip && (
                <div style={{
                    position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%',
                    transform: 'translateX(-50%)', zIndex: 50, width: 240,
                    background: 'var(--card)', border: '1px solid rgba(34,211,238,0.35)',
                    borderRadius: 10, padding: '12px 14px',
                    fontSize: '0.77rem', color: 'var(--text)', lineHeight: 1.65,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.55)', pointerEvents: 'none'
                }}>
                    <div style={{ fontWeight: 700, color: '#22D3EE', marginBottom: 6, fontSize: '0.80rem' }}>{tip.title}</div>
                    <div style={{ color: 'var(--muted)', marginBottom: 8 }}>{tip.what}</div>
                    <div style={{ borderTop: '1px solid rgba(34,211,238,0.2)', paddingTop: 7 }}>
                        <span style={{ fontWeight: 700, color: '#22D3EE', fontSize: '0.70rem', textTransform: 'uppercase', letterSpacing: 1 }}>
                            Clinical guidance
                        </span>
                        <div style={{ color: 'var(--text)', marginTop: 4 }}>{tip.guidance}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

function BurdenStat({ value, total, label, color, tip }) {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <TooltipWrap tip={tip}>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2rem", fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: 6 }}>{label}</div>
                <div style={{ background: "var(--card-inner)", borderRadius: 4, height: 4, width: "80%", margin: "0 auto" }}>
                    <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4, transition: "width 0.8s" }} />
                </div>
                <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: 4 }}>{pct}% of nights</div>
            </div>
        </TooltipWrap>
    );
}

function Ahi95Stat({ value }) {
    const pctOfTarget = Math.min(100, Math.round((value / 5) * 100));
    const tip = {
        title: "AHI 95th Percentile",
        what: "The 95th percentile AHI across your recent nights — meaning 95% of nights had an AHI at or below this value. It represents your \"worst typical night\" and is more clinically meaningful than a simple average.",
        guidance: "A value under 5 events/hr indicates well-controlled therapy even on your harder nights. Above 10 suggests recurrent poor nights that warrant attention."
    };
    return (
        <TooltipWrap tip={tip}>
            <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "2rem", fontWeight: 800, color: "#22D3EE" }}>{Number(value || 0).toFixed(1)}</div>
                <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginBottom: 6 }}>AHI 95th Percentile</div>
                <div style={{ background: "var(--card-inner)", borderRadius: 4, height: 4, width: "80%", margin: "0 auto" }}>
                    <div style={{ width: `${pctOfTarget}%`, background: "#22D3EE", height: "100%", borderRadius: 4, transition: "width 0.8s" }} />
                </div>
                <div style={{ fontSize: "0.65rem", color: "#9ca3af", marginTop: 4 }}>events / hr</div>
            </div>
        </TooltipWrap>
    );
}

function TherapyStabilityCardComponent({ burden, totalNights, rangeLabel }) {
    if (!burden || totalNights === 0) return null;

    const over5Tip = {
        title: "Nights with AHI > 5",
        what: "Count of nights where the Apnea-Hypopnea Index exceeded 5 events/hr — the clinical threshold for controlled therapy. Above 5 does not automatically mean therapy failed, but it warrants monitoring.",
        guidance: "Occasional nights above 5 are normal (illness, alcohol, sleep position). If more than 30% of nights exceed 5, discuss pressure settings or mask fit with your provider."
    };

    const over10Tip = {
        title: "Nights with AHI > 10",
        what: "Count of nights exceeding 10 events/hr, which falls into the moderate OSA range even with therapy running. These are the most clinically concerning nights in your data.",
        guidance: "Even one or two nights above 10 per month should be investigated. Consider reviewing positional data, mask seal quality, and whether your pressure range is wide enough."
    };

    return (
        <section className="panel" style={{ padding: 20 }}>
            <h3 style={{ margin: "0 0 20px 0", fontSize: "1rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h3l2-5 4 10 2-5h7" /></svg>
                Residual Burden — {rangeLabel}
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                <BurdenStat value={burden.nights_over_5 ?? 0} total={totalNights} label="Nights AHI > 5" color="#f59e0b" tip={over5Tip} />
                <BurdenStat value={burden.nights_over_10 ?? 0} total={totalNights} label="Nights AHI > 10" color="#ef4444" tip={over10Tip} />
                <Ahi95Stat value={burden.AHI_p95_30} />
            </div>
        </section>
    );
}

export const TherapyStabilityCard = memo(TherapyStabilityCardComponent);
