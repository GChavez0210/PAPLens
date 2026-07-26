/**
 * Clinical interpolation and mapping layer.
 * Groups deterministic metrics into meaningful thresholds and strings.
 *
 * NOTE: computeTherapyStabilityScore, computeComplianceRisk, processResidualBurden,
 * and hasTherapyData live in scores.js — import them from there.
 */

const { LEAK_SEVERITY_P95, LEAK_SEVERITY_P50 } = require("../../../src/shared/clinicalThresholds");

// Maps a leak value to a 0–3 severity tier using the supplied tier thresholds.
function leakTier(leakValue, tiers) {
  return leakValue > tiers.severe ? 3 : leakValue > tiers.high ? 2 : leakValue > tiers.mild ? 1 : 0;
}

// classifyLeakSeverity accepts the best available leak value plus its basis so
// thresholds can be scaled appropriately. Severity tiers are calibrated for
// leak_p95; when only the median (leak_p50) is available the threshold is halved
// (~2x lower than p95 for typical right-skewed leak distributions). Threshold
// values live in src/shared/clinicalThresholds.js so the renderer and main process
// stay in sync.
function classifyLeakSeverity(leakValue, leak50, usageMinutes, { basis = "p95" } = {}) {
  if (leakValue === null || leakValue === undefined) {
    return { tier: null, consistencyIndex: null, basis: null };
  }
  if (usageMinutes < 60) {
    return {
      tier: 0,
      consistencyIndex: leak50 > 0 ? ((leakValue - leak50) / leak50) * 100 : null,
      basis
    };
  }

  const tiers = basis === "p50" ? LEAK_SEVERITY_P50 : LEAK_SEVERITY_P95;
  let severity = leakTier(leakValue, tiers);

  // Guard against corrupted/swapped percentiles when both are present
  const effectiveLeak =
    basis === "p95" && leak50 !== null && leak50 !== undefined ? Math.max(leakValue, leak50) : leakValue;
  if (basis === "p95" && effectiveLeak !== leakValue) {
    severity = leakTier(effectiveLeak, LEAK_SEVERITY_P95);
  }

  const consistencyIndex = leak50 > 0 ? ((leakValue - leak50) / leak50) * 100 : null;
  return { tier: severity, consistencyIndex, basis };
}

// Leak columns are null when a device or parser never reported them, and a
// genuine 0 means "no unintentional leak measured" — a perfect seal, not missing
// data. So validity is a null/finite check, never `> 0`.
function leakValue(value) {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) || parsed < 0 ? null : parsed;
}

// Interpolates a penalty across one tier band, then holds the band's full weight.
function rampPenalty(value, from, to, weight) {
  if (value <= from) return 0;
  if (value >= to) return weight;
  return ((value - from) / (to - from)) * weight;
}

/**
 * Mask-fit score for one night: 0–100, higher is a better seal.
 *
 * Three terms, all anchored to the shared leak tiers so this cannot drift from
 * classifyLeakSeverity:
 *   - peak leak (p95) dominates — a high ceiling means therapy pressure escaped;
 *   - median leak (p50) is scored separately because a persistently leaky
 *     baseline is a worse fit than one brief excursion off an otherwise clean
 *     median, and a p95-only score cannot tell those apart;
 *   - leak_spike_count captures discrete seal breaks that percentiles smooth
 *     over, normalised per hour so a long night is not penalised merely for
 *     offering more chances to break.
 *
 * Returns null when no leak data exists at all, so callers can distinguish "not
 * measured" from "measured badly". The floor is 1 rather than 0 because
 * computeScores in the report builder reads a mask-fit score of exactly 0 as
 * missing data.
 */
function computeMaskFitScore(metrics) {
  const leak95 = leakValue(metrics?.leak_p95 ?? metrics?.leak_max);
  const leak50 = leakValue(metrics?.leak_p50);
  if (leak95 === null && leak50 === null) return null;

  let penalty = 0;

  if (leak95 !== null) {
    const { mild, high, severe } = LEAK_SEVERITY_P95;
    penalty += rampPenalty(leak95, mild, high, 15);
    penalty += rampPenalty(leak95, high, severe, 25);
    if (leak95 > severe) penalty += Math.min(25, (leak95 - severe) * 1.5);
  }

  if (leak50 !== null) {
    const { mild, high, severe } = LEAK_SEVERITY_P50;
    penalty += rampPenalty(leak50, mild, high, 8);
    penalty += rampPenalty(leak50, high, severe, 12);
    if (leak50 > severe) penalty += Math.min(10, (leak50 - severe) * 1.5);
  }

  const spikes = Number(metrics?.leak_spike_count);
  const usageHours = Number(metrics?.usage_hours);
  if (Number.isFinite(spikes) && spikes > 0 && Number.isFinite(usageHours) && usageHours > 0) {
    penalty += Math.min(10, (spikes / usageHours) * 2);
  }

  return Math.max(1, Math.min(100, Math.round(100 - penalty)));
}

module.exports = { classifyLeakSeverity, computeMaskFitScore };
