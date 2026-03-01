// Explanations Generator

function generateInsightNarratives(nightId, derivedMetrics, lastNightFlags) {
    const insights = [];

    // Stability
    if (derivedMetrics.stability_score !== null) {
        let title = "Stable Night";
        let summary = "Your breathing and therapy metrics were consistent.";
        if (derivedMetrics.stability_score < 70) {
            title = "Fluctuating Therapy";
            summary = "We noticed higher than normal variance in your breathing patterns or leak levels.";
        }
        insights.push({ key: "stability", title, summary, details: null });
    }

    // Mask Fit
    if (derivedMetrics.mask_fit_score !== null) {
        let title = "Good Mask Seal";
        let summary = "Your mask maintained a solid seal with minimal leaking.";
        if (derivedMetrics.mask_fit_score < 60) {
            title = "Mask Fit Issues";
            summary = "Significant mask leaking was detected, potentially compromising therapy.";
        } else if (derivedMetrics.mask_fit_score < 80) {
            title = "Moderate Leaking";
            summary = "Some mask leaking was registered but within acceptable parameters.";
        }
        insights.push({ key: "mask_fit", title, summary, details: null });
    }

    // Compliance Risk
    if (derivedMetrics.compliance_risk === "high") {
        insights.push({
            key: "compliance",
            title: "Usage Falling Behind",
            summary: "You are averaging less than 4 hours of usage recently. Consistency is key!",
            details: null
        });
    } else if (derivedMetrics.compliance_risk === "medium") {
        insights.push({
            key: "compliance",
            title: "Usage Warning",
            summary: "Your usage is dipping close to the 4-hour minimum threshold.",
            details: null
        });
    }

    // Outliers
    if (lastNightFlags && lastNightFlags.length > 0) {
        const strongFlags = lastNightFlags.filter(f => f.severity === "strong");
        if (strongFlags.length > 0) {
            insights.push({
                key: "outlier",
                title: "Unusual Night Detected",
                summary: `We detected strong deviations in: ${strongFlags.map(f => f.metric).join(", ")}.`,
                details: JSON.stringify(strongFlags)
            });
        }
    }

    return insights;
}

module.exports = { generateInsightNarratives };
