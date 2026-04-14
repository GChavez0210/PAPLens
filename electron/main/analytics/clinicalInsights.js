/**
 * Clinical interpolation and mapping layer.
 * Groups deterministic metrics into meaningful thresholds and strings.
 *
 * NOTE: computeTherapyStabilityScore, computeComplianceRisk, processResidualBurden,
 * and hasTherapyData live in scores.js — import them from there.
 */

function classifyLeakSeverity(leak95, leak50, usageMinutes) {
    if (leak95 === null || leak95 === undefined) {
        return { tier: null, consistencyIndex: null };
    }
    if (usageMinutes < 60) {
        return {
            tier: 0,
            consistencyIndex: leak50 > 0 ? ((leak95 - leak50) / leak50) * 100 : null
        };
    }
    const severity = leak95 > 24 ? 3 : leak95 > 12 ? 2 : leak95 > 5 ? 1 : 0;
    const consistencyIndex = leak50 > 0 ? ((leak95 - leak50) / leak50) * 100 : null;
    return { tier: severity, consistencyIndex };
}

module.exports = { classifyLeakSeverity };
