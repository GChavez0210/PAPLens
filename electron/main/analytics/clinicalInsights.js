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
    const effectiveLeak = (basis === "p95" && leak50 !== null && leak50 !== undefined)
        ? Math.max(leakValue, leak50)
        : leakValue;
    if (basis === "p95" && effectiveLeak !== leakValue) {
        severity = leakTier(effectiveLeak, LEAK_SEVERITY_P95);
    }

    const consistencyIndex = leak50 > 0 ? ((leakValue - leak50) / leak50) * 100 : null;
    return { tier: severity, consistencyIndex, basis };
}

module.exports = { classifyLeakSeverity };
