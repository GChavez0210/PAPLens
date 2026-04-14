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

// Count 2-second leak epochs where leak exceeds the clinical "significant leak" threshold (24 L/min).
function countLeakSpikes(leakSamplesLperMin) {
    return leakSamplesLperMin.filter(v => v > 24).length;
}

// Compute a snore index: percentage of 2-second epochs with snore signal > 0.1.
// Snore.2s values are unitless intensity (0–1). A threshold of 0.1 filters near-zero noise.
function computeSnoreIndex(snoreRaw) {
    const samples = sanitizeSamples(snoreRaw, { min: 0 });
    if (samples.length === 0) return null;
    const snoring = samples.filter(v => v > 0.1).length;
    return (snoring / samples.length) * 100; // 0–100 %
}

// Bucket pressure samples into a fixed 10-bin histogram (4–24 cmH₂O, 2 cmH₂O per bin).
// Bins outside the range are clamped to the nearest edge bucket.
// Returns an array of { lo, hi, pct } objects.
const PRESSURE_BUCKETS = Array.from({ length: 10 }, (_, i) => ({ lo: 4 + i * 2, hi: 6 + i * 2 }));

function computePressureHistogram(pressureRaw) {
    const samples = sanitizeSamples(pressureRaw, { min: 0 }).filter(v => v > 0);
    if (samples.length === 0) return null;
    const counts = new Array(PRESSURE_BUCKETS.length).fill(0);
    for (const v of samples) {
        const idx = Math.min(PRESSURE_BUCKETS.length - 1, Math.max(0, Math.floor((v - 4) / 2)));
        counts[idx]++;
    }
    return PRESSURE_BUCKETS.map((b, i) => ({ lo: b.lo, hi: b.hi, pct: (counts[i] / samples.length) * 100 }));
}

// Pressure efficiency: % of time where delivered pressure is ≥ 90% of the session maximum.
// A high value (>20%) suggests the device is consistently working near its ceiling.
function computePressureEfficiency(pressureRaw) {
    const samples = sanitizeSamples(pressureRaw, { min: 0 }).filter(v => v > 0);
    if (samples.length === 0) return null;
    const sessionMax = Math.max(...samples);
    if (sessionMax === 0) return null;
    const ceiling = sessionMax * 0.9;
    return (samples.filter(v => v >= ceiling).length / samples.length) * 100;
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
    const pressureSamples = sanitizeSamples(aggregate.pressureSamples, { min: 0 }).filter(v => v > 0);

    return {
        leak50: calculatePercentile(leakSamples, 0.5),
        leak95: calculatePercentile(leakSamples, 0.95),
        leakMax: leakSamples.length > 0 ? Math.max(...leakSamples) : null,
        leakSpikeCount: countLeakSpikes(leakSamples),
        minVent50: calculatePercentile(minVentSamples, 0.5),
        minVent95: calculatePercentile(minVentSamples, 0.95),
        tidVol50: calculatePercentile(tidalSamples, 0.5),
        tidVol95: calculatePercentile(tidalSamples, 0.95),
        respRate50: calculatePercentile(respRateSamples, 0.5),
        respRate95: calculatePercentile(respRateSamples, 0.95),
        flowLimP95: calculatePercentile(flowLimSamples, 0.95),
        snoreIndex: computeSnoreIndex(aggregate.snoreSamples),
        pressureHistogram: computePressureHistogram(pressureSamples),
        pressureEfficiency: computePressureEfficiency(pressureSamples),
        spo2Avg: average(spo2Samples),
        pulseAvg: average(pulseSamples),
        eventClusterIndexSource: computeEventClusterIndex(aggregate.annotations),
        sessionDerived: leakSamples.length > 0 || tidalSamples.length > 0 || flowLimSamples.length > 0 || spo2Samples.length > 0 || pulseSamples.length > 0 || (aggregate.annotations || []).length > 0
    };
}

module.exports = {
    computeEventClusterIndex,
    computePressureHistogram,
    computePressureEfficiency,
    computeSnoreIndex,
    countLeakSpikes,
    isRespiratoryEvent,
    normalizeLeakSamples,
    normalizeMetricSamples,
    normalizeTidalSamples,
    summarizeNightlySessionMetrics
};
