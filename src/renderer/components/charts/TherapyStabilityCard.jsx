import { memo, useState } from "react";
import { AHI_MILD, AHI_MODERATE } from "../../constants";

function TooltipWrap({ children, tip }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="burden-stat" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
      {hovered && tip && (
        <div className="hovercard is-above">
          <div className="hovercard-title">{tip.title}</div>
          <div className="hovercard-body">{tip.what}</div>
          <div className="hovercard-foot">
            <span className="hovercard-foot-label">Clinical guidance</span>
            <p>{tip.guidance}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function BurdenStat({ value, total, label, tone, tip }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <TooltipWrap tip={tip}>
      <div className={`burden-value ${tone}`}>{value}</div>
      <div className="burden-label">{label}</div>
      <div className="meter burden-meter">
        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="burden-caption">{pct}% of nights</div>
    </TooltipWrap>
  );
}

function Ahi95Stat({ value }) {
  const pctOfTarget = Math.min(100, Math.round((value / AHI_MILD) * 100));
  const tip = {
    title: "AHI 95th percentile",
    what: 'The 95th percentile AHI across your recent nights — meaning 95% of nights had an AHI at or below this value. It represents your "worst typical night" and is more clinically meaningful than a simple average.',
    guidance: `A value under ${AHI_MILD} events/hr indicates well-controlled therapy even on your harder nights. Above ${AHI_MILD * 2} suggests recurrent poor nights that warrant attention.`
  };
  const tone = value > AHI_MILD * 2 ? "is-alert" : value > AHI_MILD ? "is-watch" : "is-ok";
  return (
    <TooltipWrap tip={tip}>
      <div className={`burden-value ${tone}`}>{Number(value || 0).toFixed(1)}</div>
      <div className="burden-label">AHI 95th percentile</div>
      <div className="meter burden-meter">
        <div className={`meter-fill ${tone}`} style={{ width: `${pctOfTarget}%` }} />
      </div>
      <div className="burden-caption">events / hr</div>
    </TooltipWrap>
  );
}

function TherapyStabilityCardComponent({ burden, totalNights, rangeLabel }) {
  if (!burden || totalNights === 0) return null;

  const over5Tip = {
    title: `Nights with AHI > ${AHI_MILD}`,
    what: `Count of nights where the Apnea-Hypopnea Index exceeded ${AHI_MILD} events/hr — the clinical threshold for controlled therapy. Above ${AHI_MILD} does not automatically mean therapy failed, but it warrants monitoring.`,
    guidance: `Occasional nights above ${AHI_MILD} are normal (illness, alcohol, sleep position). If more than 30% of nights exceed ${AHI_MILD}, discuss pressure settings or mask fit with your provider.`
  };

  const over10Tip = {
    title: "Nights with AHI > 10",
    what: `Count of nights exceeding 10 events/hr, which falls into the moderate OSA range (above ${AHI_MODERATE} is severe) even with therapy running. These are the most clinically concerning nights in your data.`,
    guidance:
      "Even one or two nights above 10 per month should be investigated. Consider reviewing positional data, mask seal quality, and whether your pressure range is wide enough."
  };

  return (
    <section className="panel">
      <h3>Residual burden — {rangeLabel}</h3>
      <div className="burden-grid">
        <BurdenStat
          value={burden.nights_over_5 ?? 0}
          total={totalNights}
          label={`Nights AHI > ${AHI_MILD}`}
          tone="is-watch"
          tip={over5Tip}
        />
        <BurdenStat
          value={burden.nights_over_10 ?? 0}
          total={totalNights}
          label="Nights AHI > 10"
          tone="is-alert"
          tip={over10Tip}
        />
        <Ahi95Stat value={burden.AHI_p95_30} />
      </div>
    </section>
  );
}

export const TherapyStabilityCard = memo(TherapyStabilityCardComponent);
