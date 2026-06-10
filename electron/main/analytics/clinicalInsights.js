/**
 * Clinical interpolation and mapping layer.
 * Groups deterministic metrics into meaningful thresholds and strings.
 *
 * NOTE: computeTherapyStabilityScore, computeComplianceRisk, processResidualBurden,
 * and hasTherapyData live in scores.js — import them from there.
 */

// classifyLeakSeverity accepts the best available leak value plus its basis so
// thresholds can be scaled appropriately. Severity tiers are calibrated for
// leak_p95; when only the median (leak_p50) is available the threshold is halved
// (~2x lower than p95 for typical right-skewed leak distributions).
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

    let severity;
    if (basis === "p50") {
        // Median-scale thresholds (roughly half the p95 values)
        severity = leakValue > 12 ? 3 : leakValue > 6 ? 2 : leakValue > 2.5 ? 1 : 0;
    } else {
        severity = leakValue > 24 ? 3 : leakValue > 12 ? 2 : leakValue > 5 ? 1 : 0;
    }

    // Guard against corrupted/swapped percentiles when both are present
    const effectiveLeak = (basis === "p95" && leak50 !== null && leak50 !== undefined)
        ? Math.max(leakValue, leak50)
        : leakValue;
    if (basis === "p95" && effectiveLeak !== leakValue) {
        severity = effectiveLeak > 24 ? 3 : effectiveLeak > 12 ? 2 : effectiveLeak > 5 ? 1 : 0;
    }

    const consistencyIndex = leak50 > 0 ? ((leakValue - leak50) / leak50) * 100 : null;
    return { tier: severity, consistencyIndex, basis };
}

module.exports = { classifyLeakSeverity };
