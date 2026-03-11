import { calculatePercentile, toMetricNumber } from "./therapyMetrics";

// -- Correlation English Translation -----------------------------------------
export function getCorrelationInsight(pair, r) {
    const p = (pair || "").toLowerCase();
    const hasAll = (...terms) => terms.every(t => p.includes(t));

    if ((hasAll("leak") && hasAll("ahi")) || (hasAll("ahi") && hasAll("leak"))) {
        if (r <= -0.20) return "Negative relationship. Higher leak corresponds with lower AHI - uncommon; may indicate detection artifacts or statistical noise.";
        if (r < 0.20) return "Minimal relationship. Leak is unlikely affecting AHI.";
        if (r < 0.40) return "Mild positive. Higher leak may slightly increase AHI; mask fit could influence therapy quality.";
        if (r < 0.60) return "Moderate positive. Leak is likely impacting event control and reducing effective pressure delivery.";
        return "Strong positive. Leak is a major driver of elevated AHI and should be prioritized for correction.";
    }

    if ((hasAll("pressure") && hasAll("ahi")) || (hasAll("ahi") && hasAll("pressure"))) {
        if (r <= -0.20) return "Negative relationship. Higher pressure is associated with lower AHI, indicating effective event suppression.";
        if (r < 0.20) return "No meaningful relationship. Pressure changes are not influencing AHI.";
        if (r < 0.40) return "Mild positive. Higher pressures coincide with higher AHI; may reflect reactive pressure increases to events.";
        if (r < 0.60) return "Moderate positive. Pressure rises are strongly associated with elevated AHI, suggesting unresolved obstruction.";
        return "Strong positive. Pressure escalation is closely tied to event severity; therapy settings may need review.";
    }

    if ((hasAll("usage") && hasAll("ahi")) || (hasAll("ahi") && hasAll("usage"))) {
        if (r <= -0.20) return "Negative relationship. Increased nightly usage corresponds with lower AHI, suggesting strong adherence benefit.";
        if (r < 0.20) return "No meaningful relationship. Duration of use is not affecting event control.";
        if (r < 0.40) return "Mild positive. Longer usage correlates with slightly higher AHI; may reflect extended REM or positional exposure.";
        if (r < 0.60) return "Moderate positive. Extended usage aligns with higher AHI, possibly indicating late-night instability.";
        return "Strong positive. Longer use consistently coincides with higher events; further analysis required.";
    }

    if ((hasAll("pressure") && hasAll("leak")) || (hasAll("leak") && hasAll("pressure"))) {
        if (r <= -0.20) return "Negative relationship. Higher pressure corresponds with reduced leak, possibly due to improved mask stabilization.";
        if (r < 0.20) return "No meaningful relationship. Pressure changes are not affecting seal integrity.";
        if (r < 0.40) return "Mild positive. Higher pressures slightly increase leak; mask adjustment may be beneficial.";
        if (r < 0.60) return "Moderate positive. Pressure escalation is contributing to seal instability.";
        return "Strong positive. Pressure increases significantly worsen leak; mask type or fit likely unsuitable.";
    }

    const absR = Math.abs(r);
    if (absR < 0.20) return "No meaningful correlation detected between these metrics.";
    if (absR < 0.40) return "Mild correlation. A weak but present relationship exists between these two variables.";
    if (absR < 0.60) return "Moderate correlation. These metrics show a meaningful clinical association.";
    return "Strong correlation. These metrics are significantly related and warrant clinical attention.";
}

// -- Shared Scoring Helpers ---------------------------------------------------
export function getUsageHours(day) {
    const usage = day?.usageHours ?? day?.usage_hours;
    if (usage !== undefined && usage !== null && usage !== "") {
        const parsedUsage = Number(usage);
        return Number.isFinite(parsedUsage) ? parsedUsage : null;
    }

    const usageMinutes = day?.usage_minutes;
    if (usageMinutes !== undefined && usageMinutes !== null && usageMinutes !== "") {
        const parsedMinutes = Number(usageMinutes);
        return Number.isFinite(parsedMinutes) ? parsedMinutes / 60 : null;
    }

    return null;
}

export function hasTherapyData(day) {
    const usage = getUsageHours(day);
    return usage !== null && usage > 0;
}

export function hasUsageData(day) {
    const usage = getUsageHours(day);
    return usage !== null && usage >= 0;
}

export function isNoDataDay(day) {
    return !!day && !hasTherapyData(day);
}

export function filterAnalyzedDays(days) {
    return (days || []).filter(hasTherapyData);
}

export function filterUsageTrackedDays(days) {
    return (days || []).filter(hasUsageData);
}

export function getStabilityTier(score) {
    if (score >= 95) return { label: "Optimal", class: "good" };
    if (score >= 85) return { label: "Stable", class: "good" };
    if (score >= 70) return { label: "Acceptable", class: "warn" };
    if (score >= 50) return { label: "Suboptimal", class: "warn" };
    return { label: "High Risk", class: "bad" };
}

export function getMaskFitTier(score) {
    if (score >= 90) return { label: "Excellent", class: "good" };
    if (score >= 75) return { label: "Good", class: "good" };
    if (score >= 60) return { label: "Fair", class: "warn" };
    return { label: "Poor", class: "bad" };
}

// -- PDF Deterministic Scorer -------------------------------------------------
export function computeScores(filteredStats) {
    const analyzedDays = filterAnalyzedDays(filteredStats);
    if (analyzedDays.length === 0) {
        return null;
    }

    const lastSession = analyzedDays[analyzedDays.length - 1];
    const stabilityScore = lastSession.therapy_stability_score ?? lastSession.stability_score;
    const maskFitScore = lastSession.mask_fit_score;

    const res = {
        explanations: {}
    };

    if (stabilityScore !== undefined && stabilityScore !== null) {
        const s = Math.round(stabilityScore);
        const meta = getStabilityTier(s);
        res.stabilityScore = s;
        res.stabilityLabel = meta.label;
        res.stabilityClass = meta.class;
        res.explanations.stability = "Computed: Measures night-to-night consistency across AHI, leak, and pressure. Higher is more stable.";
    }

    if (maskFitScore !== undefined && maskFitScore !== null && maskFitScore !== 0) {
        const m = Math.round(maskFitScore);
        const meta = getMaskFitTier(m);
        res.maskFitScore = m;
        res.maskFitLabel = meta.label;
        res.maskFitClass = meta.class;
        res.explanations.maskFit = "Computed: Evaluates average flow leak limits and maximum leak occurrences over the period.";
    } else {
        res.maskFitScore = null;
    }

    if (res.stabilityScore === undefined && res.maskFitScore === null) {
        return null;
    }

    return res;
}

// -- Medical Context Builder --------------------------------------------------
export function buildClinicalContext(filteredStats, deviceInfo) {
    const analyzedDays = filterAnalyzedDays(filteredStats);
    const usageTrackedDays = filterUsageTrackedDays(filteredStats);
    if (analyzedDays.length === 0) return null;

    let validDays = 0;
    let sumCAI = 0;
    let sumOAI = 0;
    let sumHI = 0;

    const leaks = [];
    let isAuto = false;
    let minP = 999;
    let maxP = 0;

    analyzedDays.forEach(d => {
        validDays++;
        sumCAI += (d.cai || 0);
        sumOAI += (d.oai || 0);
        sumHI += (d.hi || 0);

        const leakValue = toMetricNumber(d.leak95);
        if (leakValue !== null) {
            leaks.push(leakValue);
        }

        const pMedian = d.pressure || 0;
        const p95 = d.maxPressure || pMedian;

        if (pMedian > 0 && pMedian < minP) minP = pMedian;
        if (p95 > maxP) maxP = p95;
        if (p95 > pMedian + 0.5) isAuto = true;
    });

    const compliantDays = usageTrackedDays.filter(d => (getUsageHours(d) || 0) >= 4).length;

    const avgCAI = validDays > 0 ? (sumCAI / validDays).toFixed(1) : "0.0";
    const avgOAI = validDays > 0 ? (sumOAI / validDays).toFixed(1) : "0.0";
    const avgHI = validDays > 0 ? (sumHI / validDays).toFixed(1) : "0.0";
    const adherenceNights = usageTrackedDays.length;
    const adherenceRate = adherenceNights > 0 ? Math.round((compliantDays / adherenceNights) * 100) : 0;

    const leak95thValue = calculatePercentile(leaks, 0.95);
    const leak95th = leak95thValue === null ? null : leak95thValue.toFixed(1);

    if (minP === 999) minP = 0;

    let therapyMode = "Unknown Settings";
    const modelStr = (deviceInfo?.model || "").toLowerCase();
    if (modelStr.includes("autoset") || isAuto) {
        therapyMode = `AutoSet / APAP (observed min ${minP.toFixed(1)} / max ${maxP.toFixed(1)} cmH2O)`;
    } else {
        therapyMode = `Fixed CPAP (observed ${maxP.toFixed(1)} cmH2O)`;
    }

    return {
        nightsAnalyzed: validDays,
        adherenceNights,
        adherenceRate,
        leak95th,
        avgCAI,
        avgOAI,
        avgHI,
        therapyMode
    };
}
