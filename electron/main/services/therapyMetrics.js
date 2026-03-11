function toOptionalNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function isFiniteMetricValue(value) {
    return toOptionalNumber(value) !== null;
}

function pickMappedValue(record, mappings) {
    if (!record) {
        return { value: null, field: null, rawValue: null, unit: null };
    }

    for (const mapping of mappings) {
        const fields = Array.isArray(mapping.field) ? mapping.field : [mapping.field];

        for (const field of fields) {
            if (!Object.prototype.hasOwnProperty.call(record, field)) {
                continue;
            }

            const rawValue = toOptionalNumber(record[field]);
            if (rawValue === null) {
                continue;
            }

            return {
                value: mapping.transform ? mapping.transform(rawValue) : rawValue,
                field,
                rawValue,
                unit: mapping.unit || null
            };
        }
    }

    return { value: null, field: null, rawValue: null, unit: null };
}

function sanitizeMetricSamples(values) {
    return (values || [])
        .map((value) => toOptionalNumber(value))
        .filter((value) => value !== null);
}

// Deterministic percentile calculation using linear interpolation between
// sorted samples. Empty input stays null so missing data is never masked as 0.
function calculatePercentile(values, percentile) {
    const samples = sanitizeMetricSamples(values);
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

function describeSamples(values) {
    const samples = sanitizeMetricSamples(values);
    if (samples.length === 0) {
        return { count: 0, min: null, max: null };
    }

    return {
        count: samples.length,
        min: Math.min(...samples),
        max: Math.max(...samples)
    };
}

function getRowMetricValue(row, keys) {
    for (const key of keys) {
        const value = toOptionalNumber(row?.[key]);
        if (value !== null) {
            return value;
        }
    }

    return null;
}

function buildLeakAndTidalSummary(rows, logger = console, context = "analytics") {
    const leakSamples = (rows || [])
        .map((row) => getRowMetricValue(row, ["leak_p95", "leak95"]))
        .filter((value) => value !== null);
    const tidalSamples = (rows || [])
        .map((row) => getRowMetricValue(row, ["tidal_vol_p50", "tidVol50"]))
        .filter((value) => value !== null);

    const leakStats = describeSamples(leakSamples);
    const tidalStats = describeSamples(tidalSamples);
    const leakP95 = calculatePercentile(leakSamples, 0.95);
    const tidalMedian = calculatePercentile(tidalSamples, 0.5);

    safeInfo(
        logger,
        `[${context}] Leak samples=${leakStats.count} min=${formatDebugValue(leakStats.min)} max=${formatDebugValue(leakStats.max)} p95=${formatDebugValue(leakP95)}`
    );
    safeInfo(
        logger,
        `[${context}] Tidal samples=${tidalStats.count} min=${formatDebugValue(tidalStats.min)} max=${formatDebugValue(tidalStats.max)} p50=${formatDebugValue(tidalMedian)}`
    );

    return {
        leak: leakP95,
        tidalVolume: tidalMedian,
        leakSampleCount: leakStats.count,
        tidalSampleCount: tidalStats.count
    };
}

function formatDebugValue(value) {
    return value === null ? "null" : Number(value).toFixed(3);
}

function safeInfo(logger, message) {
    if (!logger?.info || !isMetricDebugEnabled()) {
        return;
    }

    try {
        logger.info(message);
    } catch (_error) {
        // Debug logging must never interrupt imports, analytics, or UI startup.
    }
}

function isMetricDebugEnabled() {
    return process.env.PAPLENS_DEBUG_METRICS === "1";
}

const leakMappings = {
    p50: [
        { field: ["Leak.50", "Leak50", "Leak.5", "LeakMedian"], unit: "L/s", transform: (value) => value * 60 },
        { field: ["LeakRate.50", "LeakRate50", "MaskLeak.50", "MaskLeak50", "MaskLeakRate.50", "MaskLeakRate50"], unit: "L/min" }
    ],
    p95: [
        { field: ["Leak.95", "Leak95", "Leak.95th"], unit: "L/s", transform: (value) => value * 60 },
        { field: ["LeakRate.95", "LeakRate95", "MaskLeak.95", "MaskLeak95", "MaskLeakRate.95", "MaskLeakRate95"], unit: "L/min" }
    ],
    max: [
        { field: ["Leak.Max", "LeakMax"], unit: "L/s", transform: (value) => value * 60 },
        { field: ["LeakRate.Max", "LeakRateMax", "MaskLeak.Max", "MaskLeakMax"], unit: "L/min" }
    ]
};

const tidalMappings = {
    p50: [
        { field: ["TidVol.50", "TidVol50", "TidalVol.50", "TidalVol50", "TidalVolume.50", "TidalVolume50", "VT.50", "Vt.50", "Vt50"], unit: "L", transform: (value) => value * 1000 },
        { field: ["TidVolMl.50", "TidalVolumeMl.50", "TidalVolumeML.50", "TidalVolume.mL.50"], unit: "mL" }
    ],
    p95: [
        { field: ["TidVol.95", "TidVol95", "TidalVol.95", "TidalVol95", "TidalVolume.95", "TidalVolume95", "VT.95", "Vt.95", "Vt95"], unit: "L", transform: (value) => value * 1000 },
        { field: ["TidVolMl.95", "TidalVolumeMl.95", "TidalVolumeML.95", "TidalVolume.mL.95"], unit: "mL" }
    ],
    max: [
        { field: ["TidVol.Max", "TidVolMax", "TidalVol.Max", "TidalVolMax", "TidalVolume.Max", "TidalVolumeMax", "VT.Max", "Vt.Max", "VtMax"], unit: "L", transform: (value) => value * 1000 },
        { field: ["TidVolMl.Max", "TidalVolumeMl.Max", "TidalVolumeML.Max", "TidalVolume.mL.Max"], unit: "mL" }
    ]
};

module.exports = {
    buildLeakAndTidalSummary,
    calculatePercentile,
    describeSamples,
    formatDebugValue,
    isFiniteMetricValue,
    leakMappings,
    pickMappedValue,
    safeInfo,
    tidalMappings,
    toOptionalNumber
};
