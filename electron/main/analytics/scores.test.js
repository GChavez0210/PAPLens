const test = require("node:test");
const assert = require("node:assert/strict");
const { computeTherapyStabilityScore } = require("./scores");

test("low usage applies a usage penalty so the stability score is not 100", () => {
    const result = computeTherapyStabilityScore(
        {
            usage_hours: 2.9,
            ahi_total: 0,
            leak_p95: 1,
            pressure_median: 10,
            pressure_p95: 10
        },
        []
    );

    assert.equal(result.penaltyUsage, 12);
    assert.equal(result.stabilityScore, 87.7);
});

test("missing flow limitation data stays null instead of forcing a zero-derived score", () => {
    const result = computeTherapyStabilityScore(
        {
            usage_hours: 6,
            ahi_total: 0.5,
            leak_p95: 4,
            pressure_median: 10,
            pressure_p95: 11
        },
        []
    );

    assert.equal(result.penaltyFlowLim, null);
    assert.equal(result.flScore, null);
});

test("flow limitation p95 contributes a deterministic penalty when present", () => {
    const result = computeTherapyStabilityScore(
        {
            usage_hours: 7,
            ahi_total: 0.5,
            leak_p95: 4,
            pressure_median: 10,
            pressure_p95: 11,
            flow_limitation_p95: 0.22
        },
        []
    );

    assert.equal(result.penaltyFlowLim, 3);
    assert.equal(result.flScore, 60);
});
