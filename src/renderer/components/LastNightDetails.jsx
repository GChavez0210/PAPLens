import { toMetricNumber } from "../utils/therapyMetrics";
import { PB_SEVERE_PCT, PB_SIGNIFICANT_PCT, pbColor, pbSeverity } from "../utils/periodicBreathing";

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
  flow_limitation_p95: "flow limitation index"
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
      return higher ? `${label} was higher than your recent average.` : `${label} was lower than your recent average.`;
    }
  }
}

// ── Score-line explanations ──────────────────────────────────────────────────
// Each entry: what the line measures, how to read the current value, and the
// scoring rule that determines the deduction. Thresholds mirror scores.js
// (computeTherapyStabilityScore) exactly so the tooltip never contradicts the
// number shown next to it.
const SCORE_INFO = {
  ahi: {
    what: "AHI is the count of apneas + hypopneas detected per hour of therapy. Under 5/hr is considered well-controlled.",
    rule: "Deductions begin above 1/hr and reach the full 50 by 15/hr.",
    value: (d) => {
      const v = toMetricNumber(d.ahi_total);
      return v === null ? null : `${v.toFixed(1)} events/hr last night.`;
    }
  },
  leak: {
    what: "Tracks peak mask leak (95th percentile). High leak lets pressure escape and can leave events untreated.",
    rule: "Deductions begin above 10 L/min and accelerate past the 24 L/min clinical limit.",
    value: (d) => {
      const v = toMetricNumber(d.leak_p95 ?? d.leak_p50);
      return v === null || v <= 0 ? null : `Peak leak was ${v.toFixed(1)} L/min.`;
    }
  },
  usage: {
    what: "Rewards nightly therapy time. 7+ hours is ideal; under 4 hours misses the compliance minimum.",
    rule: "Points come off below 7 hrs and steepen sharply under the 4-hour minimum.",
    value: (d) => {
      const v = toMetricNumber(d.usage_hours);
      return v === null ? null : `You used therapy ${v.toFixed(1)} hrs.`;
    }
  },
  pressureVar: {
    what: "How much delivered pressure swings overnight — the 95th-percentile pressure minus the median. Large swings can fragment sleep.",
    rule: "Deductions begin above a 2 cmH₂O spread and cap at 5 pts by 6 cmH₂O.",
    value: (d, sd) => {
      const spread =
        sd?.pressureVariance ??
        (toMetricNumber(d.pressure_p95) !== null && toMetricNumber(d.pressure_median) !== null
          ? toMetricNumber(d.pressure_p95) - toMetricNumber(d.pressure_median)
          : null);
      return spread === null ? null : `Pressure spread was ${Number(spread).toFixed(1)} cmH₂O.`;
    }
  },
  flowLim: {
    what: "Flow limitation reflects partial airway narrowing (95th percentile). Sustained limitation can signal under-treatment.",
    rule: "Deductions begin above an index of 0.10 and cap at 5 pts by 0.30.",
    value: (d) => {
      const v = toMetricNumber(d.flow_limitation_p95);
      return v === null ? null : `Flow-limitation index was ${v.toFixed(2)}.`;
    }
  }
};

// Compose the full hover explanation for one score line.
function buildScoreTip(key, penalty, data, scoreDetails) {
  const info = SCORE_INFO[key];
  if (!info) return "";
  if (penalty === null || penalty === undefined) {
    return `${info.what} Not enough data to score this metric for last night.`;
  }
  const valueLine = info.value(data, scoreDetails);
  const reason =
    penalty > 0
      ? `${valueLine ? `${valueLine} ` : ""}${info.rule} That cost ${penalty} ${penalty === 1 ? "point" : "points"}.`
      : `${valueLine ? `${valueLine} ` : ""}This stayed in range, so no points were deducted.`;
  return `${info.what} ${reason}`;
}

// ── Score decomposition component ────────────────────────────────────────────
function ScoreBar({ label, penalty, maxPenalty, color, tip }) {
  const unavailable = penalty === null || penalty === undefined;
  const pct = maxPenalty > 0 ? Math.min((penalty / maxPenalty) * 100, 100) : 0;
  return (
    <div
      className={tip ? "score-bar score-bar-tip" : "score-bar"}
      style={{ marginBottom: 6 }}
      data-tip={tip || undefined}
      tabIndex={tip ? 0 : undefined}
      aria-label={tip || undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 3 }}>
        <span style={{ color: "var(--muted)" }}>{label}</span>
        <span
          style={{
            color: unavailable ? "var(--muted)" : penalty > 0 ? "var(--critical)" : "var(--success)",
            fontWeight: 600
          }}
        >
          {unavailable ? "N/A" : penalty > 0 ? `-${penalty} pts` : "Optimal"}
        </span>
      </div>
      <div style={{ background: "var(--separator)", borderRadius: 3, height: 4 }}>
        <div
          style={{
            width: unavailable ? "0%" : `${pct}%`,
            background: color,
            height: "100%",
            borderRadius: 4,
            transition: "width 0.8s ease"
          }}
        />
      </div>
    </div>
  );
}

// ── Periodic breathing (observed, not scored) ────────────────────────────────
// PB carries no penalty in computeTherapyStabilityScore — it is a pattern to
// discuss with a clinician, not a therapy-quality defect the score should punish.
// It still belongs on this card, so it renders as a peer of the score bars but
// reports its measured share of the night instead of a deduction.
function PeriodicBreathingBar({ data }) {
  const pct = toMetricNumber(data.pb_pct);
  if (pct === null) return null;

  const episodes = toMetricNumber(data.pb_episode_count);
  const severity = pbSeverity(pct);
  const color = pbColor(pct);
  const significant = data.pb_is_significant === 1;
  const confounded = data.pb_leak_confounded === 1;

  const tip = [
    "Periodic breathing is a cyclic waxing-and-waning of breath depth, typically over a 30–120 second cycle.",
    `It occupied ${pct.toFixed(1)}% of last night's recording${episodes !== null ? ` across ${episodes} episode${episodes === 1 ? "" : "s"}` : ""}.`,
    `Above ${PB_SIGNIFICANT_PCT}% of recording time is considered clinically significant.`,
    confounded
      ? "Most episodes overlapped mask-leak events, so this may be arousal-driven rather than true periodic breathing."
      : "",
    "This is observed only — it does not affect your stability score."
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="score-bar score-bar-tip" style={{ marginBottom: 6 }} data-tip={tip} tabIndex={0} aria-label={tip}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 3 }}>
        {/* No "not scored" marker here — the hover tip already says it, and the
            row reports a percentage rather than a deduction, unlike its peers. */}
        <span style={{ color: "var(--muted)" }}>Periodic Breathing</span>
        <span style={{ color, fontWeight: 600 }}>
          {severity === "none" ? "None detected" : `${pct.toFixed(1)}% of night`}
        </span>
      </div>
      <div style={{ background: "var(--separator)", borderRadius: 3, height: 4, position: "relative" }}>
        <div
          style={{
            // Same 0–20% scale the Insights PB card plots against.
            width: `${Math.min((pct / PB_SEVERE_PCT) * 100, 100)}%`,
            background: color,
            height: "100%",
            borderRadius: 4,
            transition: "width 0.8s ease"
          }}
        />
        <div
          title={`${PB_SIGNIFICANT_PCT}% clinical threshold`}
          style={{
            position: "absolute",
            top: -1,
            left: `${(PB_SIGNIFICANT_PCT / PB_SEVERE_PCT) * 100}%`,
            width: 1,
            height: 6,
            background: "var(--warning)",
            opacity: 0.6
          }}
        />
      </div>
      {significant && (
        <div style={{ fontSize: "0.68rem", color, marginTop: 4 }}>
          {confounded
            ? `Crossed the ${PB_SIGNIFICANT_PCT}% threshold, but episodes overlapped mask leak — low confidence.`
            : `Crossed the ${PB_SIGNIFICANT_PCT}% clinical threshold. Worth raising with your care team.`}
        </div>
      )}
    </div>
  );
}

/**
 * Last-night detail card: score-penalty breakdown + plain-English alert flags.
 * Presentational — the parent owns the getLastNightOverview fetch and passes
 * the result via `data`. The score ring and headline metrics now live in the
 * consolidated dashboard hero, so this card carries only the explanatory detail.
 */
export function LastNightDetails({ data }) {
  if (!data) return null;

  const outliers = data.outliers ? JSON.parse(data.outliers) : [];
  const scoreDetails = data.scoreDetails || {};

  // Leak p95 — treat 0 as no-data
  const leak95Val = toMetricNumber(data.leak_p95);
  const leak95Display = leak95Val !== null && leak95Val > 0 ? leak95Val : null;

  const pAhi = scoreDetails.penaltyAhi ?? null;
  const pLeak = scoreDetails.penaltyLeak ?? null;
  const pUsage = scoreDetails.penaltyUsage ?? null;
  const pPressVar = scoreDetails.penaltyPressureVar ?? null;
  const pFlow = scoreDetails.penaltyFlowLim ?? null;

  const hasAlerts =
    outliers.length > 0 ||
    (leak95Display !== null && leak95Display >= 24) ||
    (toMetricNumber(data.ahi_total) !== null && data.ahi_total > 5) ||
    (toMetricNumber(data.usage_hours) !== null && data.usage_hours < 4);

  return (
    <div className="detail-card">
      <div className="detail-card-header">
        <div className="section-eyebrow">Last Night Detail</div>
        <span className="detail-card-date">{data.night_date}</span>
      </div>

      <div className="detail-card-grid">
        {/* Score decomposition */}
        <div className="detail-breakdown">
          <div
            style={{
              fontSize: "0.66rem",
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
              fontWeight: 700
            }}
          >
            Score Breakdown
          </div>
          <ScoreBar
            label="Residual AHI Impact"
            penalty={pAhi}
            maxPenalty={50}
            color="var(--critical)"
            tip={buildScoreTip("ahi", pAhi, data, scoreDetails)}
          />
          <ScoreBar
            label="Leak Stability"
            penalty={pLeak}
            maxPenalty={25}
            color="var(--warning)"
            tip={buildScoreTip("leak", pLeak, data, scoreDetails)}
          />
          <ScoreBar
            label="Usage Adherence"
            penalty={pUsage}
            maxPenalty={15}
            color="var(--cyan)"
            tip={buildScoreTip("usage", pUsage, data, scoreDetails)}
          />
          <ScoreBar
            label="Pressure Variance"
            penalty={pPressVar}
            maxPenalty={5}
            color="#8b5cf6"
            tip={buildScoreTip("pressureVar", pPressVar, data, scoreDetails)}
          />
          <ScoreBar
            label="Flow Limitation"
            penalty={pFlow}
            maxPenalty={5}
            color="var(--tier-orange)"
            tip={buildScoreTip("flowLim", pFlow, data, scoreDetails)}
          />
          <PeriodicBreathingBar data={data} />

          {/* Alert flags — plain English, no raw keys */}
          <div className="detail-alerts">
            {!hasAlerts && (
              <div className="detail-allclear">
                No unusual readings flagged for last night — all metrics fell within your expected range.
              </div>
            )}
            {outliers.length > 0 &&
              outliers.map((o, i) => (
                <div key={i} className="alert-flag alert-flag-critical">
                  <div className="alert-flag-title" style={{ color: "var(--critical)" }}>
                    Unusual Reading Flagged
                  </div>
                  <div className="alert-flag-body">{describeFlagInSidebar(o.metric, o.z)}</div>
                </div>
              ))}
            {leak95Display !== null && leak95Display >= 24 && (
              <div className="alert-flag alert-flag-warning">
                <div className="alert-flag-title" style={{ color: "var(--warning)" }}>
                  Elevated Mask Leak
                </div>
                <div className="alert-flag-body">
                  Peak leak ({leak95Display.toFixed(1)} L/min) exceeded the 24 L/min clinical threshold. This reduces
                  effective pressure delivery and may allow unresolved events during the night.
                </div>
              </div>
            )}
            {toMetricNumber(data.ahi_total) !== null && data.ahi_total > 5 && (
              <div className="alert-flag alert-flag-warning">
                <div className="alert-flag-title" style={{ color: "var(--warning)" }}>
                  AHI Above Normal Range
                </div>
                <div className="alert-flag-body">
                  AHI of {Number(data.ahi_total).toFixed(1)} events/hr is above the 5 events/hr threshold considered
                  controlled therapy. Occasional elevated nights are common — watch for a persistent pattern.
                </div>
              </div>
            )}
            {toMetricNumber(data.usage_hours) !== null && data.usage_hours < 4 && (
              <div className="alert-flag alert-flag-critical">
                <div className="alert-flag-title" style={{ color: "var(--critical)" }}>
                  Usage Below Compliance Minimum
                </div>
                <div className="alert-flag-body">
                  Therapy ran for {Number(data.usage_hours).toFixed(1)} hrs, under the 4-hour nightly minimum required
                  for clinical compliance. Check your sleep schedule and address any comfort issues.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
