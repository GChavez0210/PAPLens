function toOptionalNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function calculatePercentile(values, percentile) {
    const samples = (values || [])
        .map((value) => toOptionalNumber(value))
        .filter((value) => value !== null);

    if (samples.length === 0) {
        return null;
    }

    if (samples.length === 1) {
        return samples[0];
    }

    const bounded = Math.min(1, Math.max(0, percentile));
    const sorted = [...samples].sort((a, b) => a - b);
    const index = (sorted.length - 1) * bounded;
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);

    if (lowerIndex === upperIndex) {
        return sorted[lowerIndex];
    }

    const weight = index - lowerIndex;
    return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight;
}

export function formatMetricValue(value, digits = 1, rounding = "fixed") {
    const numeric = toOptionalNumber(value);
    if (numeric === null) {
        return "N/A";
    }

    return rounding === "round" ? String(Math.round(numeric)) : numeric.toFixed(digits);
}

export function toMetricNumber(value) {
    return toOptionalNumber(value);
}
