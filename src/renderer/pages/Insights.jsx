import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "../ThemeContext";
import { filterAnalyzedDays, getCorrelationInsight } from "../utils/reportBuilder";
import { calculatePercentile, formatMetricValue, toMetricNumber } from "../utils/therapyMetrics";
import { formatNightLabel, summarizeFinding } from "../utils/findingSummaries";
import { USAGE_COMPLIANCE_HOURS } from "../constants";
import { AHITrendChart } from "../components/charts/AHITrendChart";
import { TherapyStabilityCard } from "../components/charts/TherapyStabilityCard";
import { LeakSeverityGauge } from "../components/charts/LeakSeverityGauge";
import { EventTypeSplitChart } from "../components/charts/EventTypeSplitChart";
import { FlowLimitationChart } from "../components/charts/FlowLimitationChart";
import { PressureHistogramChart } from "../components/charts/PressureHistogramChart";
import { PeriodicBreathingCard } from "../components/charts/PeriodicBreathingCard";

// Each finding carries a clinical tone, not a decorative colour. The tone
// drives one border rule and one icon tint; the card surface stays neutral.
const KEY_TONE = {
  stability: "info",
  mask_fit: "watch",
  compliance: "watch",
  outlier: "alert",
  periodic_breathing: "watch",
  flow_limitation: "watch",
  default: "info"
};

// ── Hover tooltip content for each insight type ─────────────────────────────
const INSIGHT_TOOLTIPS = {
  stability: {
    title: "What this means",
    what: "Therapy stability measures how consistent your breathing patterns and pressure delivery were across the night. High variance can signal unresolved obstruction, positional changes, or mask issues affecting how well your device adapts.",
    action:
      "Check your sleep position and mask fit. If events cluster in the second half of the night, consider positional therapy aids or review your pressure settings with your care team."
  },
  mask_fit: {
    title: "What this means",
    what: "High leak rates reduce the effective pressure delivered to your airway, potentially allowing breathing events to go unresolved. Large leaks also disrupt your device's auto-titration algorithm, causing it to escalate pressure unnecessarily.",
    action:
      "Inspect the mask cushion for wear and clean the seal surface. Re-adjust headgear tension — it should be snug but not tight. If leaks persist across multiple nights, consider a mask fitting session or a different mask style."
  },
  compliance: {
    title: "What this means",
    what: 'Insurance and clinical guidelines typically require 4+ hours of use on at least 70% of nights to classify therapy as "compliant." Consistent use is critical — benefits like blood pressure reduction and daytime alertness depend on regular nightly therapy.',
    action:
      "Set a consistent sleep schedule and address comfort barriers: pressure ramp settings, heated humidifier, a chin strap for mouth breathing, or a different mask interface can all significantly improve adherence."
  },
  outlier: {
    title: "What this means",
    what: "This night's metrics deviated significantly from your recent baseline using statistical z-score analysis. Outliers can reflect a genuine acute issue (illness, alcohol, new sleep position) or simply natural night-to-night variability.",
    action:
      "Review the specific metrics flagged. Isolated outliers rarely require action — watch for a pattern across multiple nights before adjusting therapy. If outliers occur frequently, discuss with your healthcare provider."
  },
  periodic_breathing: {
    title: "What this means",
    what: "Periodic breathing is a cyclic pattern where tidal volume alternates between deep and shallow breaths over a 30–120 second cycle. When accompanied by central apneas at the nadir it is called Cheyne-Stokes respiration — a pattern linked to heart failure, stroke, and altitude sickness.",
    action:
      "If this is flagged repeatedly, share the finding with your cardiologist or sleep physician. Adaptive servo-ventilation (ASV) or treating the underlying cardiac condition can significantly reduce CSR events."
  },
  flow_limitation: {
    title: "What this means",
    what: "Flow limitation occurs when your upper airway narrows enough to reduce airflow without a complete collapse. Your CPAP device records a 0–1 index per breath: values above 0.10 indicate mild narrowing, above 0.30 is clinically significant. The Respiratory Disturbance Index (RIN) counts flow-limited breaths that don't reach apnea or hypopnea severity but can still fragment sleep.",
    action:
      "If FL P95 is persistently above 0.30, discuss widening your pressure range or switching to an AutoPAP mode with your care team. Mild elevation (0.10–0.30) may respond to positional therapy or mask adjustments."
  },
  default: {
    title: "What this means",
    what: "This observation was flagged based on analysis of your recent therapy data and clinical thresholds.",
    action:
      "Review the details and discuss with your healthcare provider if the pattern persists across multiple nights."
  }
};

// ── Hover tooltip content for each stat metric ─────────────────────────────
const STAT_TOOLTIPS = {
  ahi: {
    title: "Apnea-Hypopnea Index (AHI)",
    what: "Average number of breathing pauses (apneas) and near-pauses (hypopneas) per hour of sleep. This is the primary measure of how well your therapy is controlling your sleep apnea.",
    impact:
      "Under 5 is normal; 5–15 mild; 15–30 moderate; above 30 is severe. Consistently elevated AHI means your airway is not staying open effectively."
  },
  usage: {
    title: "Nightly Therapy Usage",
    what: "Average hours per night the CPAP device was actively running across the selected date range.",
    impact:
      "4+ hours/night is the clinical compliance minimum. More consistent use directly correlates with better health outcomes — daytime alertness, blood pressure, and cardiovascular risk all improve with regular therapy."
  },
  pressure: {
    title: "Delivered Pressure (P50)",
    what: "The median air pressure in cmH₂O that your device delivered to keep your airway open. The 50th percentile excludes brief spikes, giving a representative picture of typical nighttime pressure.",
    impact:
      "Higher than your prescribed minimum may signal unresolved events driving the device up. Consistently near your max setting suggests your pressure range may need widening."
  },
  flow: {
    title: "Minute Ventilation (MV P50)",
    what: "Total volume of air exchanged per minute, combining breathing rate and tidal volume depth. Reflects how effectively your lungs are ventilating during therapy.",
    impact:
      "Stable ventilation confirms effective breathing support. Drops in MV alongside rising AHI may indicate central events or flow limitation not fully addressed by pressure alone."
  },
  tidal: {
    title: "Tidal Volume (P50)",
    what: "Average volume of air moved per breath, in milliliters. Measured as the 50th percentile from high-resolution session data.",
    impact:
      "Normal adult tidal volume is roughly 400–600 mL. Consistently low values may indicate shallow breathing, significant air leak reducing delivered volume, or mask sizing issues."
  },
  nights: {
    title: "Nights Analyzed",
    what: "Count of nights with sufficient therapy data (usage hours > 0) within the selected date range. Nights with no recorded usage are excluded from all averages.",
    impact:
      "More nights = more reliable statistical averages. Short ranges (under 7 nights) may show misleading averages due to natural night-to-night variability."
  }
};

function AppIcon({ type = "default", size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true
  };

  if (type === "periodic_breathing")
    return (
      <svg {...common}>
        <path d="M2 12c1-4 3-6 5-6s3.5 3 5 6 3 6 5 6 4-2 5-6" />
      </svg>
    );
  if (type === "flow_limitation")
    return (
      <svg {...common}>
        <path d="M3 12h4l2-4 3 8 2-4h7" />
        <path d="M3 17h18" strokeDasharray="3 2" />
      </svg>
    );
  if (type === "stability")
    return (
      <svg {...common}>
        <path d="M3 12h3l2-5 4 10 2-5h7" />
      </svg>
    );
  if (type === "mask_fit")
    return (
      <svg {...common}>
        <path d="M7 4h10l1 5v4a6 6 0 0 1-12 0V9l1-5z" />
        <path d="M10 12h4" />
      </svg>
    );
  if (type === "compliance")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" />
      </svg>
    );
  if (type === "outlier")
    return (
      <svg {...common}>
        <path d="M12 3 3 20h18L12 3z" />
        <path d="M12 9v5" />
        <path d="M12 17h.01" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M4 19h16" />
      <path d="M6 15l4-4 3 3 5-6" />
    </svg>
  );
}

function CorrelationBar({ r, rho, significant, n, pair, label }) {
  const [hovered, setHovered] = useState(false);
  // Prefer rho (Spearman) when available; fall back to Pearson r
  const displayCoeff = rho != null ? rho : r;
  const coeffLabel = rho != null ? "\u03c1" : "r";
  const pct = Math.abs(displayCoeff) * 100;
  const isNotSignificant = significant === false;
  const positive = displayCoeff >= 0;
  const absCoeff = Math.abs(displayCoeff);
  const direction = isNotSignificant ? "" : positive ? "is-positive" : "is-negative";
  const strength = absCoeff >= 0.6 ? "Strong" : absCoeff >= 0.4 ? "Moderate" : absCoeff >= 0.2 ? "Mild" : "Negligible";
  const tooltipText = getCorrelationInsight(pair, r);

  return (
    <div
      className={`corr ${isNotSignificant ? "is-weak" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="corr-head">
        <div className="corr-pair">
          <span className="corr-name">{pair}</span>
          {n != null && <span className="corr-n">n={n}</span>}
        </div>
        <div className="corr-meta">
          <span className={`corr-strength ${absCoeff >= 0.4 && !isNotSignificant ? "is-strong" : ""}`}>
            {isNotSignificant ? "not significant" : strength}
          </span>
          <span className={`corr-value ${direction}`}>
            {coeffLabel} = {Number(displayCoeff).toFixed(2)}
          </span>
        </div>
      </div>
      <div className="corr-track">
        <div className="corr-zero" />
        <div
          className={`corr-fill ${direction}`}
          style={{ width: `${pct / 2}%`, left: positive ? "50%" : `calc(50% - ${pct / 2}%)` }}
        />
      </div>
      <div className="corr-label">{label || "Weak correlation"}</div>
      {hovered && (
        <div className="hovercard is-above">
          <div className="hovercard-head">
            <span className="hovercard-title">Clinical interpretation</span>
            <span className="hovercard-meta">
              {coeffLabel} = {Number(displayCoeff).toFixed(2)} · {strength}
            </span>
          </div>
          {tooltipText}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight }) {
  const [hovered, setHovered] = useState(false);
  const tone = KEY_TONE[insight.key] || KEY_TONE.default;
  const icon = insight.key in KEY_TONE ? insight.key : "default";
  const tooltip = INSIGHT_TOOLTIPS[insight.key] || INSIGHT_TOOLTIPS.default;
  const scopeLabel = scopeLabelFor(insight);

  return (
    <div
      className={`finding tone-${tone}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="finding-icon">
        <AppIcon type={icon} size={16} />
      </span>
      <div>
        <div className="finding-head">
          <span className="finding-title">{insight.title}</span>
          {scopeLabel && <span className="finding-scope">{scopeLabel}</span>}
        </div>
        <div className="finding-body">{insight.summary}</div>
      </div>
      {hovered && (
        <div className="hovercard is-above">
          <div className="hovercard-title">{tooltip.title}</div>
          <div className="hovercard-body">{tooltip.what}</div>
          <div className="hovercard-foot">
            <span className="hovercard-foot-label">How to address</span>
            <p>{tooltip.action}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Findings are generated per night; the query groups them by key across the
// range and counts the nights. The card body is then composed from the range's
// trend rows (see summarizeFinding) so it describes the whole period and names
// its worst night, rather than replaying one night's stored prose.
function scopeLabelFor(finding) {
  const worst = formatNightLabel(finding.worstDate);
  if (finding.nightCount > 1) {
    return worst ? `${finding.nightCount} nights · worst ${worst}` : `${finding.nightCount} nights`;
  }
  return worst ?? formatNightLabel(finding.night_date);
}

function StatCard({ label, value, unit, sub, tooltipKey, tooltipDown = false }) {
  const [hovered, setHovered] = useState(false);
  const tip = tooltipKey ? STAT_TOOLTIPS[tooltipKey] : null;

  return (
    <div
      className="kpi"
      data-tipkey={tooltipKey || undefined}
      onMouseEnter={() => tip && setHovered(true)}
      onMouseLeave={() => tip && setHovered(false)}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value-row">
        <span className="kpi-value">{value}</span>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
      {hovered && tip && (
        <div className={`hovercard ${tooltipDown ? "is-below" : "is-above"}`}>
          <div className="hovercard-title">{tip.title}</div>
          <div className="hovercard-body">{tip.what}</div>
          <div className="hovercard-foot">
            <span className="hovercard-foot-label">Therapy impact</span>
            <p>{tip.impact}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function Insights({ range = "30", customFrom = "", customTo = "" }) {
  const theme = useTheme();
  const [data, setData] = useState(null);

  const loadData = useCallback(
    async (isCancelled = () => false) => {
      let payload;
      if (range === "custom") payload = { from: customFrom, to: customTo };
      else if (range === "all") payload = { days: 0 };
      else payload = { days: parseInt(range, 10) };
      try {
        const res = await window.cpapAPI.getInsights(payload);
        if (!isCancelled()) {
          setData(res || {});
        }
      } catch (err) {
        console.error("Failed to load insights", err);
        if (!isCancelled()) {
          setData({});
        }
      }
    },
    [customFrom, customTo, range]
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    loadData(isCancelled);
    const unsub = window.cpapAPI.onDataLoaded(() => loadData(isCancelled));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [loadData]);

  const { trends, correlations, explanations, complianceRate, complianceWindowNights, compliantNights } = data || {};
  // The query already groups to one row per finding key. Collapse again here so
  // the panel still shows one card per finding when the renderer is running
  // ahead of a main process that has not restarted onto the grouped query —
  // Electron only reloads the renderer on rebuild, never the main process.
  const rangeFindings = useMemo(() => {
    const byKey = new Map();
    for (const exp of explanations || []) {
      const nights = Number(exp.night_count) || 1;
      const existing = byKey.get(exp.key);
      if (!existing) {
        byKey.set(exp.key, { ...exp, night_count: nights });
        continue;
      }
      // Keep the most recent night's row, but the count of every night.
      const total = existing.night_count + nights;
      if ((exp.night_date || "") > (existing.night_date || "")) {
        Object.assign(existing, exp);
      }
      existing.night_count = total;
    }

    return [...byKey.values()]
      .map((exp) => {
        const nightCount = exp.night_count;
        // Prefer the range summary; the stored per-night row is the fallback for
        // keys without a summariser (or a range with no usable values).
        const ranged = summarizeFinding(exp.key, trends || [], { nightCount });
        return {
          ...exp,
          nightCount,
          title: ranged?.title ?? exp.title,
          summary: ranged?.text ?? exp.summary,
          worstDate: ranged?.worstDate ?? null
        };
      })
      .sort(
        (a, b) => b.nightCount - a.nightCount || String(b.night_date || "").localeCompare(String(a.night_date || ""))
      );
  }, [explanations, trends]);

  const sorted = useMemo(() => [...(trends || [])].reverse(), [trends]);
  const analyzed = useMemo(() => filterAnalyzedDays(sorted), [sorted]);
  const labels = useMemo(() => sorted.map((d) => d.night_date?.slice(5)), [sorted]);
  const ahiData = useMemo(() => sorted.map((d) => d.ahi_total || 0), [sorted]);
  const hasEventTypeData = useMemo(
    () =>
      analyzed.some(
        (d) => (d.obstructive_apneas_per_hr ?? 0) + (d.central_apneas_per_hr ?? 0) + (d.hypopneas_per_hr ?? 0) > 0
      ),
    [analyzed]
  );
  const hasFlowLimitationData = useMemo(
    () => analyzed.some((d) => d.flow_limitation_p95 !== null && d.flow_limitation_p95 !== undefined),
    [analyzed]
  );
  const hasPeriodicBreathingData = useMemo(() => (trends || []).some((r) => r.pb_pct != null), [trends]);

  let burden = null;
  const lastWithBurden = (trends || []).find((t) => t.residual_burden);
  if (lastWithBurden) {
    try {
      burden = JSON.parse(lastWithBurden.residual_burden);
    } catch {
      burden = null;
    }
  }

  const totalNights = analyzed.length;
  const rangeLabel = range === "all" ? "All Time" : range === "custom" ? "Custom Range" : `Last ${range} Days`;

  if (data === null) return <div className="insights-loading">Loading insights…</div>;

  return (
    <div className="insights-stack">
      {analyzed.length > 0 &&
        (() => {
          // positiveOnly=true excludes stored zeros for metrics where 0 = "no data"
          const avg = (fn, positiveOnly = false) => {
            const vals = analyzed
              .map(fn)
              .map((value) => toMetricNumber(value))
              .filter((value) => value !== null && (positiveOnly ? value > 0 : value >= 0));
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          };
          const avgAhi = avg((d) => d.ahi_total); // 0 is valid (great night)
          const avgUsage = avg((d) => d.usage_hours); // 0 would be filtered by filterAnalyzedDays already
          const avgPress = avg((d) => d.pressure_median, true); // 0 = no data sentinel
          const avgLeak50 = avg((d) => d.leak_p50, true); // 0 = no data sentinel
          const avgFlow = avg((d) => d.minute_vent_p50, true); // 0 = no data sentinel
          const metricSummary = data.metricSummary || {
            leak: calculatePercentile(
              analyzed.map((day) => day.leak_p95),
              0.95
            ),
            tidalVolume: calculatePercentile(
              analyzed.map((day) => day.tidal_vol_p50),
              0.5
            )
          };
          const displayLeak95 = toMetricNumber(metricSummary.leak);
          const displayTidal = toMetricNumber(metricSummary.tidalVolume);

          return (
            <>
              <section className="panel insights-kpi-panel">
                <h3>{rangeLabel} averages</h3>
                <div className="kpi-grid">
                  <StatCard
                    label="Average AHI"
                    value={formatMetricValue(avgAhi, 1)}
                    unit="events/hr"
                    sub={rangeLabel}
                    tooltipKey="ahi"
                    tooltipDown
                  />
                  <StatCard
                    label="Average Usage"
                    value={formatMetricValue(avgUsage, 1)}
                    unit="hours"
                    sub="per night"
                    tooltipKey="usage"
                    tooltipDown
                  />
                  <StatCard
                    label="Average Pressure"
                    value={formatMetricValue(avgPress, 1)}
                    unit="cmH₂O"
                    sub="50th percentile"
                    tooltipKey="pressure"
                    tooltipDown
                  />
                  <div className="kpi-gauge">
                    <div className="kpi-label">Average mask leak</div>
                    <LeakSeverityGauge leak50={avgLeak50} leak95={displayLeak95} height={150} theme={theme} />
                  </div>
                  <StatCard
                    label="Average Flow"
                    value={formatMetricValue(avgFlow, 1)}
                    unit="L/min"
                    sub="50th percentile"
                    tooltipKey="flow"
                  />
                  <StatCard
                    label="Average Vol."
                    value={formatMetricValue(displayTidal, 0)}
                    unit="mL"
                    sub="50th percentile"
                    tooltipKey="tidal"
                  />
                  <StatCard
                    label="Nights Analyzed"
                    value={analyzed.length}
                    unit=""
                    sub="excluding no-data"
                    tooltipKey="nights"
                  />
                </div>
              </section>

              <section className="panel insights-trend-panel">
                <h3>AHI trend ({rangeLabel})</h3>
                <div data-report-key="ahi-trend">
                  <AHITrendChart labels={labels} data={ahiData} height={220} theme={theme} />
                </div>
              </section>

              {(() => {
                // Weekend vs weekday AHI and usage comparison
                const weekendDays = analyzed.filter((d) => {
                  const dow = new Date(d.night_date).getDay();
                  return dow === 0 || dow === 6;
                });
                const weekdayDays = analyzed.filter((d) => {
                  const dow = new Date(d.night_date).getDay();
                  return dow >= 1 && dow <= 5;
                });
                const wkndAhi =
                  weekendDays.length > 0
                    ? weekendDays.reduce((a, d) => a + (d.ahi_total || 0), 0) / weekendDays.length
                    : null;
                const wkdyAhi =
                  weekdayDays.length > 0
                    ? weekdayDays.reduce((a, d) => a + (d.ahi_total || 0), 0) / weekdayDays.length
                    : null;
                const wkndUsage =
                  weekendDays.length > 0
                    ? weekendDays.reduce((a, d) => a + (d.usage_hours || 0), 0) / weekendDays.length
                    : null;
                const wkdyUsage =
                  weekdayDays.length > 0
                    ? weekdayDays.reduce((a, d) => a + (d.usage_hours || 0), 0) / weekdayDays.length
                    : null;
                if (wkndAhi === null && wkdyAhi === null) return null;

                const compTier =
                  complianceRate === null
                    ? ""
                    : complianceRate >= 70
                      ? "is-ok"
                      : complianceRate >= 50
                        ? "is-watch"
                        : "is-alert";

                return (
                  <div className="insights-split">
                    {complianceRate !== null && (
                      <section className="panel">
                        <h3>30-day compliance rate</h3>
                        <div className="compliance-row">
                          <div className="compliance-figure">
                            <div className={`compliance-pct ${compTier}`}>{complianceRate}%</div>
                            <div className="compliance-caption">nights ≥ {USAGE_COMPLIANCE_HOURS} hrs</div>
                          </div>
                          <div className="compliance-detail">
                            <div className="meter">
                              <div className={`meter-fill ${compTier}`} style={{ width: `${complianceRate}%` }} />
                            </div>
                            <div className="compliance-counts">
                              {compliantNights} of {complianceWindowNights} nights qualify
                            </div>
                            <div className={`compliance-verdict ${complianceRate >= 70 ? "is-ok" : "is-watch"}`}>
                              {complianceRate >= 70
                                ? "Insurance compliance threshold met"
                                : "Below 70% CMS compliance threshold"}
                            </div>
                          </div>
                        </div>
                      </section>
                    )}

                    <section className="panel">
                      <h3>Weekend vs weekday</h3>
                      <div className="compare-grid">
                        {[
                          { label: "AHI", wkdy: wkdyAhi, wknd: wkndAhi, unit: "events/hr" },
                          { label: "Usage", wkdy: wkdyUsage, wknd: wkndUsage, unit: "hrs" }
                        ].map(({ label, wkdy, wknd, unit }) => {
                          const delta = wkdy !== null && wknd !== null ? wknd - wkdy : null;
                          return (
                            <div key={label} className="compare-cell">
                              <span className="kpi-label">{label}</span>
                              <div className="compare-pair">
                                <div className="compare-side">
                                  <div className="compare-side-label">Weekday</div>
                                  <div className="compare-side-value">{wkdy !== null ? wkdy.toFixed(1) : "—"}</div>
                                </div>
                                <div className="compare-side is-right">
                                  <div className="compare-side-label">Weekend</div>
                                  <div className="compare-side-value">{wknd !== null ? wknd.toFixed(1) : "—"}</div>
                                </div>
                              </div>
                              {delta !== null && (
                                <div className={`compare-delta ${Math.abs(delta) < 0.3 ? "" : "is-notable"}`}>
                                  Δ {delta > 0 ? "+" : ""}
                                  {delta.toFixed(1)} {unit} on weekends
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
              {hasEventTypeData && (
                <section className="panel">
                  <h3>Event type breakdown ({rangeLabel})</h3>
                  <div data-report-key="event-split">
                    <EventTypeSplitChart trends={sorted} height={220} theme={theme} />
                  </div>
                </section>
              )}

              {/* Flow limitation & RIN */}
              {hasFlowLimitationData && (
                <section className="panel">
                  <div className="section-head">
                    <h3 className="section-title">Flow limitation &amp; respiratory disturbance ({rangeLabel})</h3>
                    <p className="section-note">
                      FL P95 measures airway narrowing intensity; RIN counts flow-limited breaths that didn&rsquo;t
                      score as events.
                    </p>
                  </div>
                  <div data-report-key="flow-limit">
                    <FlowLimitationChart trends={sorted} height={200} theme={theme} />
                  </div>
                </section>
              )}

              {/* Pressure distribution — averaged across all nights with histogram data */}
              {(() => {
                const histNights = sorted.filter((d) => d.pressure_histogram);
                if (histNights.length === 0) return null;

                // Parse all available histograms
                const parsed = histNights
                  .map((d) => {
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
                  .map((b) => ({ lo: b.lo, hi: b.hi, pct: b.total / b.count }));

                // Average pressure efficiency across nights that have it
                const effNights = histNights.filter(
                  (d) => d.pressure_efficiency !== null && d.pressure_efficiency !== undefined
                );
                const avgEff =
                  effNights.length > 0
                    ? effNights.reduce((s, d) => s + d.pressure_efficiency, 0) / effNights.length
                    : null;

                return (
                  <section className="panel">
                    <div className="section-head">
                      <h3 className="section-title">Pressure distribution ({rangeLabel})</h3>
                      <p className="section-note">
                        Average % of 2-second epochs at each pressure level across {parsed.length} night
                        {parsed.length !== 1 ? "s" : ""} with high-resolution data.
                        {avgEff !== null && ` Avg time near pressure ceiling: ${avgEff.toFixed(1)}%.`}
                      </p>
                    </div>
                    <PressureHistogramChart histogram={avgHist} height={200} theme={theme} />
                  </section>
                );
              })()}
            </>
          );
        })()}

      {/* Periodic Breathing / Cheyne-Stokes analysis */}
      {hasPeriodicBreathingData && (
        <section className="panel">
          <h3>Periodic breathing analysis ({rangeLabel})</h3>
          <PeriodicBreathingCard trends={trends} />
        </section>
      )}

      {rangeFindings.length > 0 && (
        <section className="panel">
          <h3>Findings — {rangeLabel}</h3>
          <div className="finding-grid">
            {rangeFindings.map((exp) => (
              <InsightCard key={`${exp.night_id}-${exp.key}`} insight={exp} />
            ))}
          </div>
        </section>
      )}

      <TherapyStabilityCard burden={burden} totalNights={totalNights} rangeLabel={rangeLabel} />

      <section className="panel">
        <h3>Metric correlations ({rangeLabel})</h3>
        {correlations && correlations.length > 0 ? (
          <div className="corr-grid">
            {correlations.map((c) => (
              <CorrelationBar
                key={`${c.x}-${c.y}`}
                pair={`${c.x} ↔ ${c.y}`}
                r={c.r}
                rho={c.rho}
                pValue={c.pValue}
                significant={c.significant}
                n={c.n}
                label={c.label}
              />
            ))}
          </div>
        ) : (
          <div className="empty-note">
            <AppIcon type="default" size={16} />
            <span>Not enough data for correlations. Requires at least 2 nights of recorded sessions.</span>
          </div>
        )}
      </section>
    </div>
  );
}
