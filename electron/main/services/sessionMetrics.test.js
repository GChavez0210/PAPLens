const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeNightlySessionMetrics } = require("./sessionMetrics");

test("summarizeNightlySessionMetrics converts PLD samples into nightly aggregates", () => {
    const result = summarizeNightlySessionMetrics({
        leakSamples: [0.02, 0.05, 0.1],
        tidalSamples: [0.32, 0.34, 0.36],
        minVentSamples: [5, 6, 7],
        respRateSamples: [12, 14, 16],
        flowLimSamples: [0.0, 0.1, 0.4],
        spo2Samples: [95, 96, 97],
        pulseSamples: [60, 62, 64],
        annotations: [
            { onsetSeconds: 0, text: "Central Apnea" },
            { onsetSeconds: 120, text: "Hypopnea" },
            { onsetSeconds: 240, text: "Obstructive Apnea" }
        ]
    });

    assert.equal(result.leak50, 3);
    assert.equal(result.tidVol50, 340);
    assert.equal(result.spo2Avg, 96);
    assert.equal(result.pulseAvg, 62);
    assert.equal(result.eventClusterIndexSource, 3);
    assert.ok(result.flowLimP95 > 0.35);
});

test("summarizeNightlySessionMetrics drops invalid oximetry sentinel values", () => {
    const result = summarizeNightlySessionMetrics({
        leakSamples: [],
        tidalSamples: [],
        minVentSamples: [],
        respRateSamples: [],
        flowLimSamples: [],
        spo2Samples: [-1, -1],
        pulseSamples: [-1, -1],
        annotations: []
    });

    assert.equal(result.spo2Avg, null);
    assert.equal(result.pulseAvg, null);
});

test("summarizeNightlySessionMetrics returns zero cluster count when annotations exist without respiratory events", () => {
    const result = summarizeNightlySessionMetrics({
        leakSamples: [],
        tidalSamples: [],
        minVentSamples: [],
        respRateSamples: [],
        flowLimSamples: [],
        spo2Samples: [],
        pulseSamples: [],
        annotations: [{ onsetSeconds: 0, text: "Recording starts" }]
    });

    assert.equal(result.eventClusterIndexSource, 0);
});
