// ── Correlation English Translation ──────────────────────────────────────────
export function getCorrelationInsight(pair, r) {
    const p = (pair || "").toLowerCase();
    const hasAll = (...terms) => terms.every(t => p.includes(t));

    // Leak ↔ AHI
    if ((hasAll("leak") && hasAll("ahi")) || (hasAll("ahi") && hasAll("leak"))) {
        if (r <= -0.20) return "Negative relationship. Higher leak corresponds with lower AHI — uncommon; may indicate detection artifacts or statistical noise.";
        if (r < 0.20) return "Minimal relationship. Leak is unlikely affecting AHI.";
        if (r < 0.40) return "Mild positive. Higher leak may slightly increase AHI; mask fit could influence therapy quality.";
        if (r < 0.60) return "Moderate positive. Leak is likely impacting event control and reducing effective pressure delivery.";
        return "Strong positive. Leak is a major driver of elevated AHI and should be prioritized for correction.";
    }

    // Pressure ↔ AHI
    if ((hasAll("pressure") && hasAll("ahi")) || (hasAll("ahi") && hasAll("pressure"))) {
        if (r <= -0.20) return "Negative relationship. Higher pressure is associated with lower AHI, indicating effective event suppression.";
        if (r < 0.20) return "No meaningful relationship. Pressure changes are not influencing AHI.";
        if (r < 0.40) return "Mild positive. Higher pressures coincide with higher AHI; may reflect reactive pressure increases to events.";
        if (r < 0.60) return "Moderate positive. Pressure rises are strongly associated with elevated AHI, suggesting unresolved obstruction.";
        return "Strong positive. Pressure escalation is closely tied to event severity; therapy settings may need review.";
    }

    // Usage ↔ AHI
    if ((hasAll("usage") && hasAll("ahi")) || (hasAll("ahi") && hasAll("usage"))) {
        if (r <= -0.20) return "Negative relationship. Increased nightly usage corresponds with lower AHI, suggesting strong adherence benefit.";
        if (r < 0.20) return "No meaningful relationship. Duration of use is not affecting event control.";
        if (r < 0.40) return "Mild positive. Longer usage correlates with slightly higher AHI; may reflect extended REM or positional exposure.";
        if (r < 0.60) return "Moderate positive. Extended usage aligns with higher AHI, possibly indicating late-night instability.";
        return "Strong positive. Longer use consistently coincides with higher events; further analysis required.";
    }

    // Pressure ↔ Leak
    if ((hasAll("pressure") && hasAll("leak")) || (hasAll("leak") && hasAll("pressure"))) {
        if (r <= -0.20) return "Negative relationship. Higher pressure corresponds with reduced leak, possibly due to improved mask stabilization.";
        if (r < 0.20) return "No meaningful relationship. Pressure changes are not affecting seal integrity.";
        if (r < 0.40) return "Mild positive. Higher pressures slightly increase leak; mask adjustment may be beneficial.";
        if (r < 0.60) return "Moderate positive. Pressure escalation is contributing to seal instability.";
        return "Strong positive. Pressure increases significantly worsen leak; mask type or fit likely unsuitable.";
    }

    // Fallback
    const absR = Math.abs(r);
    if (absR < 0.20) return "No meaningful correlation detected between these metrics.";
    if (absR < 0.40) return "Mild correlation. A weak but present relationship exists between these two variables.";
    if (absR < 0.60) return "Moderate correlation. These metrics show a meaningful clinical association.";
    return "Strong correlation. These metrics are significantly related and warrant clinical attention.";
}

// ── Shared Scoring Helpers ───────────────────────────────────────────────────

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

// ── PDF Deterministic Scorer ─────────────────────────────────────────────────
export function computeScores(filteredStats) {
    if (!filteredStats || filteredStats.length === 0) {
        return null; // Return empty payload block if no data
    }

    // Grab the most recent session's pre-calculated overall scores
    // Since filteredStats is chronological ascending, last item is the most recent night
    const lastSession = filteredStats[filteredStats.length - 1];

    const stabilityScore = lastSession.therapy_stability_score || lastSession.stability_score;
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

    // Prevent default 0 unless it's strictly calculated as 0 (we'll assume falsy/undefined means missing for this context, 
    // unless someone explicitly scored 0 which is rare. Better safely omit than alarm with 0).
    if (maskFitScore !== undefined && maskFitScore !== null && maskFitScore !== 0) {
        const m = Math.round(maskFitScore);
        const meta = getMaskFitTier(m);
        res.maskFitScore = m;
        res.maskFitLabel = meta.label;
        res.maskFitClass = meta.class;
        res.explanations.maskFit = "Computed: Evaluates average flow leak limits and maximum leak occurrences over the period.";
    } else {
        // Mask fit not calculable / missing inputs
        res.maskFitScore = null;
    }

    // Return null if neither score was computed
    if (res.stabilityScore === undefined && res.maskFitScore === null) {
        return null;
    }

    return res;
}

// ── Medical Context Builder ──────────────────────────────────────────────────
export function buildClinicalContext(filteredStats, deviceInfo) {
    if (!filteredStats || filteredStats.length === 0) return null;

    let validDays = 0;
    let compliantDays = 0;

    let sumCAI = 0;
    let sumOAI = 0;
    let sumHI = 0;

    const leaks = [];
    let isAuto = false;
    let minP = 999;
    let maxP = 0;

    filteredStats.forEach(d => {
        if (d.usageHours !== undefined && d.usageHours !== null) {
            validDays++;
            if (d.usageHours >= 4) compliantDays++;
        }
        sumCAI += (d.cai || 0);
        sumOAI += (d.oai || 0);
        sumHI += (d.hi || 0);

        if (d.leak95 !== undefined && d.leak95 !== null) {
            leaks.push(d.leak95);
        }

        const pMedian = d.pressure || 0;
        const p95 = d.maxPressure || pMedian;

        if (pMedian > 0 && pMedian < minP) minP = pMedian;
        if (p95 > maxP) maxP = p95;
        if (p95 > pMedian + 0.5) isAuto = true; // Noticeable variance implies APAP
    });

    const avgCAI = validDays > 0 ? (sumCAI / validDays).toFixed(1) : "0.0";
    const avgOAI = validDays > 0 ? (sumOAI / validDays).toFixed(1) : "0.0";
    const avgHI = validDays > 0 ? (sumHI / validDays).toFixed(1) : "0.0";
    const adherenceRate = validDays > 0 ? Math.round((compliantDays / validDays) * 100) : 0;

    leaks.sort((a, b) => a - b);
    let leak95th = "0.0";
    if (leaks.length > 0) {
        const index95 = Math.floor(leaks.length * 0.95);
        // Clamp to not overflow array bounds if length is exactly index95
        const safeIndex = Math.min(index95, leaks.length - 1);
        leak95th = leaks[safeIndex].toFixed(1);
    }

    if (minP === 999) minP = 0;

    let therapyMode = "Unknown Settings";
    const modelStr = (deviceInfo?.model || "").toLowerCase();

    // AutoSet devices + derived autoset characteristic
    if (modelStr.includes("autoset") || isAuto) {
        therapyMode = `AutoSet / APAP (observed min ${minP.toFixed(1)} / max ${maxP.toFixed(1)} cmH₂O)`;
    } else {
        therapyMode = `Fixed CPAP (observed ${maxP.toFixed(1)} cmH₂O)`;
    }

    return {
        nightsAnalyzed: validDays,
        adherenceRate,
        leak95th,
        avgCAI,
        avgOAI,
        avgHI,
        therapyMode
    };
}

