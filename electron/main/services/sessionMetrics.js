const { calculatePercentile, toOptionalNumber } = require("./therapyMetrics");

function sanitizeSamples(values, { min = null } = {}) {
    return (values || [])
        .map((value) => toOptionalNumber(value))
        .filter((value) => value !== null && (min === null || value >= min));
}

function average(values) {
    const samples = sanitizeSamples(values);
    if (samples.length === 0) {
        return null;
    }

    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function normalizeLeakSamples(values) {
    return sanitizeSamples(values, { min: 0 }).map((value) => value * 60);
}

function normalizeTidalSamples(values) {
    return sanitizeSamples(values, { min: 0 }).map((value) => value * 1000);
}

function normalizeMetricSamples(values) {
    return sanitizeSamples(values, { min: 0 });
}

function isRespiratoryEvent(annotation) {
    const text = annotation?.text || "";
    return /(apnea|hypopnea|rera|flow limitation|clear airway|obstructive|central|unclassified)/i.test(text);
}

// Counts the densest respiratory-event cluster in any 10-minute window.
function computeEventClusterIndex(annotations) {
    const annotationList = annotations || [];
    if (annotationList.length === 0) {
        return null;
    }

    const eventTimes = annotationList
        .filter(isRespiratoryEvent)
        .map((annotation) => toOptionalNumber(annotation.onsetSeconds))
        .filter((value) => value !== null)
        .sort((a, b) => a - b);

    if (eventTimes.length === 0) {
        return 0;
    }

    const windowSeconds = 10 * 60;
    let maxCount = 0;
    let start = 0;

    for (let end = 0; end < eventTimes.length; end++) {
        while (eventTimes[end] - eventTimes[start] > windowSeconds) {
            start++;
        }
        maxCount = Math.max(maxCount, end - start + 1);
    }

    return maxCount;
}

function summarizeNightlySessionMetrics(aggregate) {
    if (!aggregate) {
        return null;
    }

    const leakSamples = normalizeLeakSamples(aggregate.leakSamples);
    const tidalSamples = normalizeTidalSamples(aggregate.tidalSamples);
    const minVentSamples = normalizeMetricSamples(aggregate.minVentSamples);
    const respRateSamples = normalizeMetricSamples(aggregate.respRateSamples);
    const flowLimSamples = normalizeMetricSamples(aggregate.flowLimSamples);
    const spo2Samples = sanitizeSamples(aggregate.spo2Samples, { min: 1 });
    const pulseSamples = sanitizeSamples(aggregate.pulseSamples, { min: 1 });

    return {
        leak50: calculatePercentile(leakSamples, 0.5),
        leak95: calculatePercentile(leakSamples, 0.95),
        leakMax: leakSamples.length > 0 ? Math.max(...leakSamples) : null,
        minVent50: calculatePercentile(minVentSamples, 0.5),
        minVent95: calculatePercentile(minVentSamples, 0.95),
        tidVol50: calculatePercentile(tidalSamples, 0.5),
        tidVol95: calculatePercentile(tidalSamples, 0.95),
        respRate50: calculatePercentile(respRateSamples, 0.5),
        respRate95: calculatePercentile(respRateSamples, 0.95),
        flowLimP95: calculatePercentile(flowLimSamples, 0.95),
        spo2Avg: average(spo2Samples),
        pulseAvg: average(pulseSamples),
        eventClusterIndexSource: computeEventClusterIndex(aggregate.annotations),
        sessionDerived: leakSamples.length > 0 || tidalSamples.length > 0 || flowLimSamples.length > 0 || spo2Samples.length > 0 || pulseSamples.length > 0 || (aggregate.annotations || []).length > 0
    };
}

module.exports = {
    computeEventClusterIndex,
    isRespiratoryEvent,
    normalizeLeakSamples,
    normalizeMetricSamples,
    normalizeTidalSamples,
    summarizeNightlySessionMetrics
};
