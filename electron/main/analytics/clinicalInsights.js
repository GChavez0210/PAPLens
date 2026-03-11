/**
 * Clinical interpolation and mapping layer.
 * Groups deterministic metrics into meaningful thresholds and strings.
 */
const { calculatePercentile } = require("../services/therapyMetrics");

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

function computeTherapyStabilityScore(current, historyMatrix) {
    let score = 100;
    let variance = 0;
    let flScore = 0;
    let clusterIndex = 0;

    if (current.ahi_total > 5) score -= (current.ahi_total - 5) * 5;
    if (current.leak_p95 > 24) score -= 15;

    if (historyMatrix && historyMatrix.length > 0) {
        const histAhi = historyMatrix.map(h => h.ahi_total);
        const avgAhi = histAhi.reduce((a, b) => a + b, 0) / histAhi.length;
        if (current.ahi_total > avgAhi * 1.5) score -= 10;
    }

    return {
        stabilityScore: Math.max(0, Math.min(100, score)),
        pressureVariance: variance,
        flScore,
        clusterIndex
    };
}

function computeComplianceRisk(usageHoursArray) {
    if (!usageHoursArray || usageHoursArray.length === 0) return "Unknown";
    const compliantDays = usageHoursArray.filter(h => h >= 4).length;
    const pct = compliantDays / usageHoursArray.length;
    if (pct >= 0.7) return "Low";
    if (pct >= 0.3) return "Medium";
    return "High";
}

function processResidualBurden(ahi30) {
    if (!ahi30 || ahi30.length === 0) return null;
    const over5 = ahi30.filter(a => a > 5).length;
    const over10 = ahi30.filter(a => a > 10).length;
    const p95 = calculatePercentile(ahi30, 0.95);

    return {
        nights_over_5: over5,
        nights_over_10: over10,
        AHI_p95_30: p95
    };
}

function hasTherapyData(current) {
    return current && current.usage_hours > 0;
}

module.exports = {
    classifyLeakSeverity,
    computeTherapyStabilityScore,
    computeComplianceRisk,
    processResidualBurden,
    hasTherapyData
};
