import { memo, useMemo, useState } from "react";
import { PB_SEVERITY_COLOR, pbSeverity } from "../../utils/periodicBreathing";

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
  const accent = severity === "elevated" && majorityConfounded ? "#a78bfa" : PB_SEVERITY_COLOR[severity];

  // The flag banner keeps its own warning colour so a green card can still
  // carry an amber "n nights crossed 5%" note without the two contradicting.
  const flagAccent = majorityConfounded ? "#a78bfa" : "var(--warning)";

  // The badge reports presence, the card colour reports severity — so a sub-5%
  // average keeps the card green (the average is not clinically significant)
  // while the badge goes amber to mark that PB was detected at all.
  const badgeAccent = severity === "normal" ? "var(--warning)" : accent;

  const borderColor = accent;
  const bgColor = severity === "none" ? "var(--card)" : `color-mix(in srgb, ${accent} 7%, var(--card))`;
  const badgeColor = badgeAccent;
  const badgeBg = `color-mix(in srgb, ${badgeAccent} 15%, transparent)`;
  const badgeLabel =
    severity === "none"
      ? "None"
      : severity === "severe"
        ? "⚠ Severe"
        : severity === "elevated"
          ? majorityConfounded
            ? "? Possibly Significant"
            : "⚠ Clinically Significant"
          : "Detected";

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
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke={borderColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2 12c1-4 3-6 5-6s3.5 3 5 6 3 6 5 6 4-2 5-6" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--text)" }}>Periodic Breathing</span>
        </div>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            color: badgeColor,
            background: badgeBg,
            borderRadius: 5,
            padding: "3px 8px",
            letterSpacing: "0.03em"
          }}
        >
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.72rem",
              color: "var(--muted)",
              marginBottom: 4
            }}
          >
            <span>PB% across selected range</span>
            <span style={{ fontWeight: 700, color: borderColor }}>{avgPbPct.toFixed(1)}%</span>
          </div>
          <div style={{ background: "var(--card-inner)", borderRadius: 4, height: 6 }}>
            <div
              style={{
                height: "100%",
                borderRadius: 4,
                background: borderColor,
                width: `${Math.min(100, avgPbPct * 5)}%`,
                transition: "width 0.4s ease"
              }}
            />
          </div>
          {/* Threshold marker at 5% (= 25% of bar width since the bar scale is ×5, i.e. 0–20%) */}
          <div style={{ position: "relative", height: 0 }}>
            <div
              style={{
                position: "absolute",
                top: 1,
                left: "25%",
                width: 1,
                height: 6,
                background: "#f59e0b60"
              }}
            />
          </div>
          {/* Scale labels aligned to their true positions on the 0–20% scale */}
          <div style={{ position: "relative", fontSize: "0.65rem", color: "var(--muted)", marginTop: 9, height: 14 }}>
            <span style={{ position: "absolute", left: 0 }}>0%</span>
            <span style={{ position: "absolute", left: "25%", transform: "translateX(-50%)", color: "#f59e0b" }}>
              5% threshold
            </span>
            <span style={{ position: "absolute", right: 0 }}>20%+</span>
          </div>
        </div>
      )}

      {anySignificant && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: 6,
            background: `color-mix(in srgb, ${flagAccent} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${flagAccent} 30%, transparent)`,
            fontSize: "0.78rem",
            color: flagAccent,
            lineHeight: 1.5
          }}
        >
          {majorityConfounded ? (
            <>
              <strong>Low confidence:</strong> {significantNights.length} night
              {significantNights.length !== 1 ? "s" : ""} met the ≥5% threshold, but most episodes coincided with mask
              leak events — these may be arousal-driven rather than true periodic breathing. Mention to your care team
              if leak issues are recurring.
            </>
          ) : (
            <>
              <strong>Clinical flag:</strong> {significantNights.length} night
              {significantNights.length !== 1 ? "s" : ""} met the ≥5% periodic breathing threshold. Discuss with your
              sleep physician or cardiologist.
            </>
          )}
        </div>
      )}

      {/* Hover tooltip */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--card)",
            border: `1px solid ${borderColor}`,
            borderRadius: 10,
            padding: "14px 16px",
            fontSize: "0.78rem",
            color: "var(--text)",
            lineHeight: 1.7,
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            pointerEvents: "none"
          }}
        >
          <div style={{ fontWeight: 700, color: borderColor, fontSize: "0.82rem", marginBottom: 8 }}>
            {TOOLTIP.title}
          </div>
          <div style={{ color: "var(--muted)", marginBottom: 10 }}>{TOOLTIP.what}</div>
          <div style={{ borderTop: `1px solid ${borderColor}40`, paddingTop: 8 }}>
            <span
              style={{
                fontWeight: 700,
                color: borderColor,
                fontSize: "0.75rem",
                textTransform: "uppercase",
                letterSpacing: 1
              }}
            >
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
    <div
      style={{
        background: "var(--card-inner)",
        borderRadius: 7,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 3
      }}
    >
      <span style={{ fontSize: "0.68rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "1.05rem", fontWeight: 700, color: accent }}>{value}</span>
    </div>
  );
}
