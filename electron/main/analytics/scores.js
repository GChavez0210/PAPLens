const { EPSILON, mean } = require("./rolling");
const { regressionSlopeValue } = require("./regression");
const { calculatePercentile } = require("../services/therapyMetrics");

const round1 = (value) => Math.round(value * 10) / 10;

function hasTherapyData(metrics) {
  const usage = Number(metrics?.usage_hours ?? (metrics?.usage_minutes ? metrics.usage_minutes / 60 : NaN));
  return Number.isFinite(usage) && usage > 0;
}

function numericMetric(metrics, keys) {
  for (const key of keys) {
    const value = Number(metrics?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function historyZPenalty(currentValue, history, keys, direction = 1) {
  if (!Number.isFinite(currentValue) || !Array.isArray(history) || history.length < 7) {
    return 0;
  }

  const values = history.map((metrics) => numericMetric(metrics, keys)).filter((value) => value !== null);
  if (values.length < 7) return 0;

  const mu = mean(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mu, 2), 0) / (values.length - 1);
  const sigma = Math.sqrt(variance);
  if (sigma <= EPSILON) return 0;

  const z = ((currentValue - mu) / sigma) * direction;
  if (z <= 1) return 0;
  return Math.min(5, (z - 1) * 2);
}

function historyPressureSpreadPenalty(currentSpread, history) {
  if (!Number.isFinite(currentSpread) || !Array.isArray(history) || history.length < 7) {
    return 0;
  }

  const values = history
    .map((metrics) => {
      const p95 = numericMetric(metrics, ["pressure_p95"]);
      const median = numericMetric(metrics, ["pressure_median"]);
      return p95 !== null && median !== null ? p95 - median : null;
    })
    .filter((value) => value !== null);
  if (values.length < 7) return 0;

  const mu = mean(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mu, 2), 0) / (values.length - 1);
  const sigma = Math.sqrt(variance);
  if (sigma <= EPSILON) return 0;

  const z = (currentSpread - mu) / sigma;
  if (z <= 1) return 0;
  return Math.min(5, (z - 1) * 2);
}

// Metrics whose absence computeTherapyStabilityScore reports via `missingFields`.
// Used by diagnostics.js to spot systematic parser/device gaps (DATA-14).
const STABILITY_TRACKED_FIELDS = ["ahi_total", "leak", "usage", "pressure_spread", "rin_per_hr", "flow_limitation_p95"];

function computeTherapyStabilityScore(currentMetrics, history = []) {
  if (!hasTherapyData(currentMetrics)) {
    return {
      stabilityScore: null,
      penaltyAhi: null,
      penaltyLeak: null,
      penaltyUsage: null,
      penaltyPressureVar: null,
      penaltyRin: null,
      penaltyFlowLim: null,
      pressureVariance: null,
      flScore: null,
      clusterIndex: null,
      missingFields: [...STABILITY_TRACKED_FIELDS]
    };
  }

  const ahi = Number(currentMetrics.ahi_total ?? 0);
  const penaltyAhi = (() => {
    if (ahi <= 1) return 0;
    if (ahi <= 5) return (ahi - 1) * 5;
    if (ahi <= 15) return 20 + (ahi - 5) * 3;
    return 50;
  })();

  let penaltyLeak = 0;
  const leak95 = currentMetrics.leak_p95 ?? currentMetrics.leak_max ?? currentMetrics.leak_p50;
  if (leak95 !== null && leak95 !== undefined) {
    if (leak95 <= 10) penaltyLeak = 0;
    else if (leak95 <= 24) penaltyLeak = (leak95 - 10) * (15 / 14);
    else penaltyLeak = 15 + Math.min(10, (leak95 - 24) * 0.5);
  }

  const usageStr = Number(
    currentMetrics.usage_hours ?? (currentMetrics.usage_minutes != null ? currentMetrics.usage_minutes / 60 : NaN)
  );
  const penaltyUsage = (() => {
    if (usageStr >= 7) return 0;
    if (usageStr >= 4) return (7 - usageStr) * 3;
    return Math.min(15, 9 + (4 - usageStr) * 3);
  })();

  // pressureSpread = p95 − median (cmH₂O). This is a percentile spread ≈ 1.35σ for
  // normally-distributed pressure, not a true standard deviation. Penalty thresholds
  // (>2, >6 cmH₂O) are calibrated for this spread scale, not for σ.
  let penaltyPressureVar = null;
  let pressureSpread = null;
  if (
    currentMetrics.pressure_p95 !== undefined &&
    currentMetrics.pressure_p95 !== null &&
    currentMetrics.pressure_median !== undefined &&
    currentMetrics.pressure_median !== null
  ) {
    pressureSpread = currentMetrics.pressure_p95 - currentMetrics.pressure_median;
    if (pressureSpread <= 2) penaltyPressureVar = 0;
    else if (pressureSpread <= 6) penaltyPressureVar = (pressureSpread - 2) * 1.25;
    else penaltyPressureVar = 5;
  }

  // RIN (Respiratory Disturbance Index): flow limitations that scored below the
  // hypopnea threshold. A penalty starts at RIN > 5 and caps at 10 events/hr (5 pts).
  let penaltyRin = null;
  const rin = currentMetrics.rin_per_hr;
  if (rin !== undefined && rin !== null) {
    if (rin <= 5) penaltyRin = 0;
    else if (rin <= 15) penaltyRin = (rin - 5) * 0.5;
    else penaltyRin = 5;
  }

  let penaltyFlowLim = null;
  const flp95 = currentMetrics.flow_limitation_p95;
  if (flp95 !== undefined && flp95 !== null) {
    if (flp95 <= 0.1) penaltyFlowLim = 0;
    else if (flp95 <= 0.3) penaltyFlowLim = (flp95 - 0.1) * 25;
    else penaltyFlowLim = 5;
  }

  // Name every tracked metric that resolved to null after its fallback chain, so a
  // systematic parser failure (e.g. leak_p95 never populated for a device) is visible
  // rather than silently absorbed by the `??` chains above (DATA-14).
  const missingFields = [];
  if (currentMetrics.ahi_total === undefined || currentMetrics.ahi_total === null) missingFields.push("ahi_total");
  if (leak95 === undefined || leak95 === null) missingFields.push("leak");
  if (!Number.isFinite(usageStr)) missingFields.push("usage");
  if (pressureSpread === null) missingFields.push("pressure_spread");
  if (rin === undefined || rin === null) missingFields.push("rin_per_hr");
  if (flp95 === undefined || flp95 === null) missingFields.push("flow_limitation_p95");

  const historicalPenalty = [
    historyZPenalty(ahi, history, ["ahi_total"]),
    historyZPenalty(leak95, history, ["leak_p95", "leak_max", "leak_p50"]),
    historyZPenalty(usageStr, history, ["usage_hours"], -1),
    historyPressureSpreadPenalty(pressureSpread, history),
    historyZPenalty(rin, history, ["rin_per_hr"]),
    historyZPenalty(flp95, history, ["flow_limitation_p95"])
  ].reduce((sum, value) => sum + value, 0);

  const totalPenalty = [
    penaltyAhi,
    penaltyLeak,
    penaltyUsage,
    penaltyPressureVar,
    penaltyRin,
    penaltyFlowLim,
    historicalPenalty
  ]
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const finalScore = Math.max(0, Math.min(100, 100 - totalPenalty));

  // Round penalties first so that flScore is derived from the same value consumers see.
  // One decimal, not whole points: finalScore is computed from the *unrounded* penalties,
  // so rounding to an integer reported a sub-point deduction (e.g. 0.4) as 0, which the
  // breakdown UI renders as "Optimal" on a night that had in fact lost points.
  const roundedFlPenalty = penaltyFlowLim === null ? null : round1(penaltyFlowLim);
  return {
    stabilityScore: finalScore,
    penaltyAhi: round1(penaltyAhi),
    penaltyLeak: round1(penaltyLeak),
    penaltyUsage: round1(penaltyUsage),
    penaltyPressureVar: penaltyPressureVar === null ? null : round1(penaltyPressureVar),
    penaltyRin: penaltyRin === null ? null : round1(penaltyRin),
    penaltyFlowLim: roundedFlPenalty,
    penaltyHistoricalBaseline: round1(historicalPenalty),
    pressureVariance: pressureSpread,
    flScore: roundedFlPenalty === null ? null : Math.round(roundedFlPenalty * 20),
    clusterIndex: null,
    missingFields
  };
}

function computeComplianceRisk(recent14DaysUsage) {
  const validUsage = (recent14DaysUsage || []).map((v) =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0
  );
  if (validUsage.length === 0) return null;

  const last7 = validUsage.slice(0, 7);
  const prev7 = validUsage.slice(7, 14);
  const avg7 = mean(last7);
  const avg14 = mean(validUsage);
  const slope14 = regressionSlopeValue([...validUsage].reverse());
  const avgPrior = prev7.length > 0 ? mean(prev7) : avg7;
  const pctChange = (avg7 - avgPrior) / Math.max(avgPrior, EPSILON);

  if (avg7 < 4 || (avg14 < 4 && slope14 < 0)) return "high";
  if ((avg7 >= 4 && avg7 < 5) || pctChange < -0.15) return "medium";
  return "low";
}

function processResidualBurden(ahiList30) {
  if (!ahiList30 || ahiList30.length === 0) return null;
  const over5 = ahiList30.filter((a) => a > 5).length;
  const over10 = ahiList30.filter((a) => a > 10).length;
  const ahiP95 = calculatePercentile(ahiList30, 0.95);
  return { nights_over_5: over5, nights_over_10: over10, AHI_p95_30: ahiP95 };
}

module.exports = {
  computeTherapyStabilityScore,
  computeComplianceRisk,
  processResidualBurden,
  hasTherapyData
};
