const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildLeakAndTidalSummary,
    calculatePercentile,
    leakMappings,
    pickMappedValue,
    tidalMappings
} = require("./therapyMetrics");

test("calculatePercentile returns null for empty input", () => {
    assert.equal(calculatePercentile([], 0.95), null);
});

test("leak mappings preserve zero and convert liters per second to liters per minute", () => {
    assert.equal(pickMappedValue({ "Leak.95": 0 }, leakMappings.p95).value, 0);
    assert.equal(pickMappedValue({ "Leak.95": 0.08 }, leakMappings.p95).value, 4.8);
});

test("tidal mappings convert liters to milliliters", () => {
    assert.equal(pickMappedValue({ "TidVol.50": 0.32 }, tidalMappings.p50).value, 320);
});

test("buildLeakAndTidalSummary computes p95 leak and p50 tidal volume from valid samples", () => {
    const summary = buildLeakAndTidalSummary(
        [
            { leak_p95: 4.8, tidal_vol_p50: 320 },
            { leak_p95: 6.0, tidal_vol_p50: 340 },
            { leak_p95: null, tidal_vol_p50: null },
            { leak_p95: 9.0, tidal_vol_p50: 360 }
        ],
        { info() {} },
        "test"
    );

    assert.equal(summary.leak, calculatePercentile([4.8, 6.0, 9.0], 0.95));
    assert.equal(summary.tidalVolume, calculatePercentile([320, 340, 360], 0.5));
});
