const { EPSILON, mean } = require("./rolling");
const { regressionSlope } = require("./regression");
const { calculatePercentile } = require("../services/therapyMetrics");

function hasTherapyData(metrics) {
    const usage = Number(metrics?.usage_hours ?? (metrics?.usage_minutes ? metrics.usage_minutes / 60 : NaN));
    return Number.isFinite(usage) && usage > 0;
}

function computeTherapyStabilityScore(currentMetrics) {
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
            clusterIndex: null
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

    const usageStr = Number(currentMetrics.usage_hours ?? (currentMetrics.usage_minutes != null ? currentMetrics.usage_minutes / 60 : NaN));
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
    if (currentMetrics.pressure_p95 !== undefined && currentMetrics.pressure_p95 !== null &&
        currentMetrics.pressure_median !== undefined && currentMetrics.pressure_median !== null) {
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
        if (flp95 <= 0.10) penaltyFlowLim = 0;
        else if (flp95 <= 0.30) penaltyFlowLim = (flp95 - 0.10) * 25;
        else penaltyFlowLim = 5;
    }

    const totalPenalty = [penaltyAhi, penaltyLeak, penaltyUsage, penaltyPressureVar, penaltyRin, penaltyFlowLim]
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + value, 0);
    const finalScore = Math.max(0, Math.min(100, 100 - totalPenalty));

    // Round penalties first so that flScore is derived from the same value consumers see.
    const roundedFlPenalty = penaltyFlowLim === null ? null : Math.round(penaltyFlowLim);
    return {
        stabilityScore: finalScore,
        penaltyAhi: Math.round(penaltyAhi),
        penaltyLeak: Math.round(penaltyLeak),
        penaltyUsage: Math.round(penaltyUsage),
        penaltyPressureVar: penaltyPressureVar === null ? null : Math.round(penaltyPressureVar),
        penaltyRin: penaltyRin === null ? null : Math.round(penaltyRin),
        penaltyFlowLim: roundedFlPenalty,
        pressureVariance: pressureSpread,
        flScore: roundedFlPenalty === null ? null : roundedFlPenalty * 20,
        clusterIndex: null
    };
}

function computeComplianceRisk(recent14DaysUsage) {
    const validUsage = (recent14DaysUsage || []).map(v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0));
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
    const ahiP95 = calculatePercentile(ahiList30, 0.95);
    return { nights_over_5: over5, nights_over_10: over10, AHI_p95_30: ahiP95 };
}

module.exports = {
    computeTherapyStabilityScore,
    computeComplianceRisk,
    processResidualBurden,
    hasTherapyData
};
