const { EPSILON, mean, std, zScore, cv } = require("./rolling");
const { pearsonR, regressionSlope } = require("./regression");

// Comprehensive Stability Score Model (Phase 9 Penalty Engine)
function computeTherapyStabilityScore(currentMetrics, historyMetrics) {
    // 1. AHI Penalty (0 to 50)
    let penaltyAhi = 0;
    const ahi = currentMetrics.ahi_total || 0;
    if (ahi <= 1) penaltyAhi = 0;
    else if (ahi <= 5) penaltyAhi = (ahi - 1) * 5;
    else if (ahi <= 15) penaltyAhi = 20 + (ahi - 5) * 3;
    else penaltyAhi = 50;

    // 2. Leak Penalty (0 to 25)
    let penaltyLeak = 0;
    const leak95 = currentMetrics.leak_p95 !== undefined ? currentMetrics.leak_p95 : (currentMetrics.leak_max || (currentMetrics.leak_p50 || 0));
    if (leak95 <= 10) penaltyLeak = 0;
    else if (leak95 <= 24) penaltyLeak = (leak95 - 10) * (15 / 14);
    else penaltyLeak = 15 + Math.min(10, (leak95 - 24) * 0.5);

    // 3. Usage Penalty (0 to 15)
    let penaltyUsage = 0;
    const usageStr = currentMetrics.usage_hours || (currentMetrics.usage_minutes ? currentMetrics.usage_minutes / 60 : 7);
    if (usageStr >= 7) penaltyUsage = 0;
    else if (usageStr >= 4) penaltyUsage = (7 - usageStr) * 3;
    else penaltyUsage = Math.min(15, 9 + (4 - usageStr) * 3);

    // 4. Pressure Variability Penalty (0 to 5)
    let penaltyPressureVar = 0;
    let pressureSd = 0;
    if (currentMetrics.pressure_p95 !== undefined && currentMetrics.pressure_median !== undefined) {
        pressureSd = currentMetrics.pressure_p95 - currentMetrics.pressure_median;
    } else {
        if (historyMetrics && historyMetrics.length > 0) {
            const pList = historyMetrics.map(h => h.pressure_median).filter(v => v !== undefined);
            pList.push(currentMetrics.pressure_median || 0);
            pressureSd = std(pList, mean(pList));
        } else {
            pressureSd = 1.0;
        }
    }
    if (pressureSd <= 2) penaltyPressureVar = 0;
    else if (pressureSd <= 6) penaltyPressureVar = (pressureSd - 2) * 1.25;
    else penaltyPressureVar = 5;

    // 5. Flow Limitation Penalty (0 to 5)
    let penaltyFlowLim = 0;
    const flp95 = currentMetrics.flow_limitation_p95 || 0.05; // Fallback if data missing
    if (flp95 <= 0.10) penaltyFlowLim = 0;
    else if (flp95 <= 0.30) penaltyFlowLim = (flp95 - 0.10) * 25;
    else penaltyFlowLim = 5;

    // Composite
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

// 3. Leak Severity Classification
function classifyLeakSeverity(leak95, leakDurationMinutes, totalUsageMinutes) {
    const defaultLeak = leak95 || 0;
    const usageStr = (totalUsageMinutes || 480);
    const duration = leakDurationMinutes || 0; // If parser doesn't provide, assume 0 for now until raw integration
    const durationPct = (duration / usageStr) * 100;

    let tier = 1; // Stable

    if (defaultLeak > 35 || duration >= 30) {
        tier = 4; // Severe
    } else if (defaultLeak > 24 || durationPct > 10) {
        tier = 3; // Moderate
    } else if (defaultLeak > 10 || (durationPct > 0 && durationPct <= 10)) {
        tier = 2; // Mild
    }

    return {
        tier,
        consistencyIndex: durationPct
    };
}


// Legacy/Supporting formulas
function computeComplianceRisk(recent14DaysUsage) {
    if (recent14DaysUsage.length === 0) return "high";
    const last7 = recent14DaysUsage.slice(0, 7);
    const prev7 = recent14DaysUsage.slice(7, 14);
    const avg_7 = mean(last7);
    const avg_14 = mean(recent14DaysUsage);
    const slope_14 = regressionSlope([...recent14DaysUsage].reverse());
    const avg_prior = mean(prev7);
    const pct_change = (avg_7 - avg_prior) / Math.max(avg_prior, EPSILON);

    if (avg_7 < 4 || (avg_14 < 4 && slope_14 < 0)) return "high";
    if ((avg_7 >= 4 && avg_7 < 5) || pct_change < -0.15) return "medium";
    return "low";
}

function processResidualBurden(ahiList30) {
    if (!ahiList30 || ahiList30.length === 0) return null;
    const over5 = ahiList30.filter(a => a > 5).length;
    const over10 = ahiList30.filter(a => a > 10).length;
    const sorted = [...ahiList30].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const ahi_p95_30 = sorted[p95Index] || 0;
    return { nights_over_5: over5, nights_over_10: over10, AHI_p95_30: ahi_p95_30 };
}

module.exports = {
    computeTherapyStabilityScore,
    classifyLeakSeverity,
    computeComplianceRisk,
    processResidualBurden
};
