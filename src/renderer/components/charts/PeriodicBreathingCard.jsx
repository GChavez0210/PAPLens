import { memo, useMemo, useState } from "react";
import { PB_SEVERE_PCT, PB_SIGNIFICANT_PCT, pbSeverity, pbStatusClass } from "../../utils/periodicBreathing";

const TOOLTIP = {
  title: "What this means",
  what: "Periodic breathing (PB) is a cyclic pattern where breathing alternates between deep breaths and shallow breaths or brief pauses, typically with a 30–120 second cycle. When it occurs during sleep, especially with central apneas at the nadir, it is called Cheyne-Stokes respiration (CSR) — a pattern associated with heart failure, stroke, and high-altitude exposure.",
  action:
    "PB above 5% of recording time is considered clinically significant. If flagged, share this finding with your cardiologist or sleep physician. CSR can often be addressed by optimizing CPAP pressure, switching to adaptive servo-ventilation (ASV), or treating the underlying cardiac condition."
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
  const nights = useMemo(() => (trends || []).filter((r) => r.pb_pct != null), [trends]);

  if (!trends || trends.length === 0) return null;

  // Aggregate PB stats across the selected date range
  if (nights.length === 0) return null;

  const significantNights = nights.filter((r) => r.pb_is_significant === 1);
  const anySignificant = significantNights.length > 0;
  const confoundedSignificant = significantNights.filter((r) => r.pb_leak_confounded === 1);
  const majorityConfounded =
    significantNights.length > 0 && confoundedSignificant.length > significantNights.length / 2;
  const avgPbPct = nights.reduce((sum, r) => sum + (r.pb_pct ?? 0), 0) / nights.length;
  const totalEpisodes = nights.reduce((sum, r) => sum + (r.pb_episode_count ?? 0), 0);
  const totalPBSec = nights.reduce((sum, r) => sum + (r.pb_total_seconds ?? 0), 0);

  const cycleSecs = nights.map((r) => r.pb_avg_cycle_sec).filter((v) => v != null && v > 0);
  const avgCycle = cycleSecs.length > 0 ? Math.round(cycleSecs.reduce((a, b) => a + b, 0) / cycleSecs.length) : null;

  const hasPB = avgPbPct > 0;

  // Severity follows the range-average PB% the card headlines, on the same scale
  // as the bar below. Individual nights that crossed 5% are surfaced by the flag
  // banner rather than recolouring the card — an average below the threshold is
  // not itself clinically significant.
  const severity = pbSeverity(avgPbPct);
  const tone = pbStatusClass(avgPbPct);

  // The badge reports presence, the card reports severity — so a sub-5% average
  // keeps an "in range" tone while the badge still marks that PB was detected.
  const badgeTone = severity === "normal" ? "is-watch" : tone;
  const badgeLabel =
    severity === "none"
      ? "None"
      : severity === "severe"
        ? "Severe"
        : severity === "elevated"
          ? majorityConfounded
            ? "Possibly significant"
            : "Clinically significant"
          : "Detected";

  // Bar scale runs 0–PB_SEVERE_PCT, so the clinical threshold sits at a fixed
  // fraction of the track regardless of the measured value.
  const barPct = Math.min(100, (avgPbPct / PB_SEVERE_PCT) * 100);
  const thresholdPct = (PB_SIGNIFICANT_PCT / PB_SEVERE_PCT) * 100;

  return (
    <div
      className={`pb-card tone-${tone.replace("is-", "")}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="pb-card-head">
        <div className="pb-card-title">
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2 12c1-4 3-6 5-6s3.5 3 5 6 3 6 5 6 4-2 5-6" />
          </svg>
          <span>Periodic breathing</span>
        </div>
        <span className={`pb-badge ${badgeTone}`}>{badgeLabel}</span>
      </div>

      <div className="pb-stats">
        <StatCell label="Avg PB%" value={hasPB ? `${avgPbPct.toFixed(1)}%` : "0%"} tone={tone} />
        <StatCell label="Episodes" value={hasPB ? totalEpisodes : "0"} tone={tone} />
        <StatCell label="Total PB time" value={hasPB ? formatDuration(totalPBSec) : "—"} tone={tone} />
        <StatCell label="Avg cycle" value={avgCycle ? `${avgCycle}s` : "—"} tone={tone} />
      </div>

      {hasPB && (
        <div className="pb-meter">
          <div className="pb-meter-head">
            <span>PB% across selected range</span>
            <span className={`pb-meter-value ${tone}`}>{avgPbPct.toFixed(1)}%</span>
          </div>
          <div className="meter pb-meter-track">
            <div className={`meter-fill ${tone}`} style={{ width: `${barPct}%` }} />
            <div className="pb-meter-threshold" style={{ left: `${thresholdPct}%` }} />
          </div>
          <div className="pb-meter-scale">
            <span className="pb-scale-start">0%</span>
            <span className="pb-scale-threshold" style={{ left: `${thresholdPct}%` }}>
              {PB_SIGNIFICANT_PCT}% threshold
            </span>
            <span className="pb-scale-end">{PB_SEVERE_PCT}%+</span>
          </div>
        </div>
      )}

      {anySignificant && (
        <div className={`pb-flag ${majorityConfounded ? "is-muted" : "is-watch"}`}>
          {majorityConfounded ? (
            <>
              <strong>Low confidence:</strong> {significantNights.length} night
              {significantNights.length !== 1 ? "s" : ""} met the ≥{PB_SIGNIFICANT_PCT}% threshold, but most episodes
              coincided with mask leak events — these may be arousal-driven rather than true periodic breathing. Mention
              to your care team if leak issues are recurring.
            </>
          ) : (
            <>
              <strong>Clinical flag:</strong> {significantNights.length} night
              {significantNights.length !== 1 ? "s" : ""} met the ≥{PB_SIGNIFICANT_PCT}% periodic breathing threshold.
              Discuss with your sleep physician or cardiologist.
            </>
          )}
        </div>
      )}

      {hovered && (
        <div className="hovercard is-above">
          <div className="hovercard-title">{TOOLTIP.title}</div>
          <div className="hovercard-body">{TOOLTIP.what}</div>
          <div className="hovercard-foot">
            <span className="hovercard-foot-label">How to address</span>
            <p>{TOOLTIP.action}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export const PeriodicBreathingCard = memo(PeriodicBreathingCardComponent);

function StatCell({ label, value, tone }) {
  return (
    <div className="pb-stat">
      <span className="kpi-label">{label}</span>
      <span className={`pb-stat-value ${tone}`}>{value}</span>
    </div>
  );
}
