// Explanations Generator

/**
 * Human-readable label for each tracked metric key.
 * Used wherever DB column names would otherwise appear in UI text or reports.
 */
const METRIC_LABELS = {
    ahi_total:        "AHI (Apnea-Hypopnea Index)",
    pressure_median:  "delivered pressure",
    leak_p50:         "mask leak",
    minute_vent_p50:  "minute ventilation",
    tidal_vol_p50:    "tidal volume",
    usage_hours:      "therapy usage"
};

/**
 * Direction-aware description for a single outlier flag.
 * Uses the z-score sign to say "higher" or "lower" in plain English.
 * For clinical metrics, adds context about whether the direction is concerning.
 */
function describeFlagInContext(metric, z) {
    const higher = z > 0;

    switch (metric) {
        case "usage_hours":
            return higher
                ? "therapy usage was longer than usual"
                : "therapy usage was shorter than usual — check adherence";

        case "ahi_total":
            return higher
                ? "AHI was notably higher than your recent average"
                : "AHI was notably lower than usual — a positive sign";

        case "leak_p50":
            return higher
                ? "mask leak was higher than your typical baseline"
                : "mask leak was unusually low — excellent seal";

        case "pressure_median":
            return higher
                ? "delivered pressure was higher than your recent average"
                : "delivered pressure was lower than your recent average";

        case "minute_vent_p50":
            return higher
                ? "breathing volume was notably higher than usual"
                : "breathing volume was notably lower than usual";

        case "tidal_vol_p50":
            return higher
                ? "tidal volume was above your recent baseline"
                : "tidal volume was below your recent baseline";

        default: {
            const label = METRIC_LABELS[metric] || metric;
            return higher
                ? `${label} was higher than your recent average`
                : `${label} was lower than your recent average`;
        }
    }
}

/**
 * Picks a specific title when exactly one metric is deviating.
 */
function titleForSingleFlag(metric, z) {
    const higher = z > 0;
    switch (metric) {
        case "usage_hours":
            return higher ? "Extended Usage Night" : "Reduced Therapy Usage";
        case "ahi_total":
            return higher ? "Elevated Event Count" : "Exceptionally Low AHI";
        case "leak_p50":
            return higher ? "Elevated Mask Leak" : "Very Low Mask Leak";
        case "pressure_median":
            return higher ? "Higher Pressure Delivery" : "Lower Pressure Delivery";
        case "minute_vent_p50":
            return higher ? "Elevated Breathing Volume" : "Reduced Breathing Volume";
        case "tidal_vol_p50":
            return higher ? "High Tidal Volume" : "Low Tidal Volume";
        default:
            return "Unusual Metric Detected";
    }
}

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
            summary: "You are averaging less than 4 hours of therapy use recently. Consistency is key to effective treatment.",
            details: null
        });
    } else if (derivedMetrics.compliance_risk === "medium") {
        insights.push({
            key: "compliance",
            title: "Usage Warning",
            summary: "Your nightly usage is dipping close to the 4-hour minimum threshold. Try to maintain consistent therapy.",
            details: null
        });
    }

    // Outliers — build human-readable, direction-aware descriptions
    if (lastNightFlags && lastNightFlags.length > 0) {
        const strongFlags = lastNightFlags.filter(f => f.severity === "strong");
        if (strongFlags.length > 0) {
            const descriptions = strongFlags.map(f => describeFlagInContext(f.metric, f.z));

            let title;
            let summary;

            if (strongFlags.length === 1) {
                title = titleForSingleFlag(strongFlags[0].metric, strongFlags[0].z);
                summary = `This night stood out because ${descriptions[0]}.`;
            } else {
                title = "Unusual Night Detected";
                const listed = descriptions
                    .map((d, i) => (i === descriptions.length - 1 && descriptions.length > 1 ? `and ${d}` : d))
                    .join(descriptions.length > 2 ? ", " : " ");
                summary = `This night stood out because ${listed}.`;
            }

            insights.push({
                key: "outlier",
                title,
                summary,
                details: JSON.stringify(strongFlags)
            });
        }
    }

    return insights;
}

module.exports = { generateInsightNarratives, METRIC_LABELS, describeFlagInContext };
