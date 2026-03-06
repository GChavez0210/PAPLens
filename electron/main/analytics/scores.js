const { EPSILON, mean, std } = require("./rolling");
const { regressionSlope } = require("./regression");

function hasTherapyData(metrics) {
    const usage = Number(metrics?.usage_hours ?? (metrics?.usage_minutes ? metrics.usage_minutes / 60 : NaN));
    return Number.isFinite(usage) && usage > 0;
}

function computeTherapyStabilityScore(currentMetrics, historyMetrics) {
    if (!hasTherapyData(currentMetrics)) {
        return {
            stabilityScore: null,
            penaltyAhi: null,
            penaltyLeak: null,
            penaltyUsage: null,
            penaltyPressureVar: null,
            penaltyFlowLim: null,
            pressureVariance: null,
            flScore: null,
            clusterIndex: null
        };
    }

    const validHistory = (historyMetrics || []).filter(hasTherapyData);

    let penaltyAhi = 0;
    const ahi = currentMetrics.ahi_total || 0;
    if (ahi <= 1) penaltyAhi = 0;
    else if (ahi <= 5) penaltyAhi = (ahi - 1) * 5;
    else if (ahi <= 15) penaltyAhi = 20 + (ahi - 5) * 3;
    else penaltyAhi = 50;

    let penaltyLeak = 0;
    const leak95 = currentMetrics.leak_p95 !== undefined ? currentMetrics.leak_p95 : (currentMetrics.leak_max || (currentMetrics.leak_p50 || 0));
    if (leak95 <= 10) penaltyLeak = 0;
    else if (leak95 <= 24) penaltyLeak = (leak95 - 10) * (15 / 14);
    else penaltyLeak = 15 + Math.min(10, (leak95 - 24) * 0.5);

    let penaltyUsage = 0;
    const usageStr = currentMetrics.usage_hours || (currentMetrics.usage_minutes ? currentMetrics.usage_minutes / 60 : 7);
    if (usageStr >= 7) penaltyUsage = 0;
    else if (usageStr >= 4) penaltyUsage = (7 - usageStr) * 3;
    else penaltyUsage = Math.min(15, 9 + (4 - usageStr) * 3);

    let penaltyPressureVar = 0;
    let pressureSd = 0;
    if (currentMetrics.pressure_p95 !== undefined && currentMetrics.pressure_median !== undefined) {
        pressureSd = currentMetrics.pressure_p95 - currentMetrics.pressure_median;
    } else if (validHistory.length > 0) {
        const pList = validHistory.map(h => h.pressure_median).filter(v => v !== undefined);
        pList.push(currentMetrics.pressure_median || 0);
        pressureSd = std(pList, mean(pList));
    } else {
        pressureSd = 1.0;
    }
    if (pressureSd <= 2) penaltyPressureVar = 0;
    else if (pressureSd <= 6) penaltyPressureVar = (pressureSd - 2) * 1.25;
    else penaltyPressureVar = 5;

    let penaltyFlowLim = 0;
    const flp95 = currentMetrics.flow_limitation_p95 || 0.05;
    if (flp95 <= 0.10) penaltyFlowLim = 0;
    else if (flp95 <= 0.30) penaltyFlowLim = (flp95 - 0.10) * 25;
    else penaltyFlowLim = 5;

    const totalPenalty = penaltyAhi + penaltyLeak + penaltyUsage + penaltyPressureVar + penaltyFlowLim;
    const finalScore = Math.max(0, Math.min(100, 100 - totalPenalty));

    return {
        stabilityScore: finalScore,
        penaltyAhi: Math.round(penaltyAhi),
        penaltyLeak: Math.round(penaltyLeak),
        penaltyUsage: Math.round(penaltyUsage),
        penaltyPressureVar: Math.round(penaltyPressureVar),
        penaltyFlowLim: Math.round(penaltyFlowLim),
        pressureVariance: pressureSd,
        flScore: Math.round(penaltyFlowLim * 20),
        clusterIndex: 0
    };
}

function classifyLeakSeverity(leak95, leakDurationMinutes, totalUsageMinutes) {
    const defaultLeak = leak95 || 0;
    const usageStr = totalUsageMinutes || 480;
    const duration = leakDurationMinutes || 0;
    const durationPct = (duration / usageStr) * 100;

    let tier = 1;
    if (defaultLeak > 35 || duration >= 30) {
        tier = 4;
    } else if (defaultLeak > 24 || durationPct > 10) {
        tier = 3;
    } else if (defaultLeak > 10 || (durationPct > 0 && durationPct <= 10)) {
        tier = 2;
    }

    return {
        tier,
        consistencyIndex: durationPct
    };
}

function computeComplianceRisk(recent14DaysUsage) {
    const validUsage = (recent14DaysUsage || []).map(Number).filter(v => Number.isFinite(v) && v > 0);
    if (validUsage.length === 0) return null;

    const last7 = validUsage.slice(0, 7);
    const prev7 = validUsage.slice(7, 14);
    const avg7 = mean(last7);
    const avg14 = mean(validUsage);
    const slope14 = regressionSlope([...validUsage].reverse());
    const avgPrior = prev7.length > 0 ? mean(prev7) : avg7;
    const pctChange = (avg7 - avgPrior) / Math.max(avgPrior, EPSILON);

    if (avg7 < 4 || (avg14 < 4 && slope14 < 0)) return "high";
    if ((avg7 >= 4 && avg7 < 5) || pctChange < -0.15) return "medium";
    return "low";
}

function processResidualBurden(ahiList30) {
    if (!ahiList30 || ahiList30.length === 0) return null;
    const over5 = ahiList30.filter(a => a > 5).length;
    const over10 = ahiList30.filter(a => a > 10).length;
    const sorted = [...ahiList30].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const ahiP95 = sorted[p95Index] || 0;
    return { nights_over_5: over5, nights_over_10: over10, AHI_p95_30: ahiP95 };
}

module.exports = {
    computeTherapyStabilityScore,
    classifyLeakSeverity,
    computeComplianceRisk,
    processResidualBurden,
    hasTherapyData
};
