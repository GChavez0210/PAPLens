const test = require("node:test");
const assert = require("node:assert/strict");
const { detectOutliers } = require("./outliers");

const makeNight = (overrides = {}) => ({
    usage_hours: 7,
    ahi_total: 2,
    pressure_median: 10,
    leak_p50: 5,
    ...overrides
});

// DATA-6: fewer than 3 history nights must never produce outlier flags

test("no flags when history is empty (first night)", () => {
    const result = detectOutliers(makeNight({ ahi_total: 100 }), []);
    assert.deepEqual(result.flags, []);
    assert.deepEqual(result.z_scores, {});
});

test("no flags when history has only 1 night", () => {
    const result = detectOutliers(makeNight({ ahi_total: 100 }), [makeNight()]);
    assert.deepEqual(result.flags, []);
});

test("no flags when history has exactly 2 nights", () => {
    const result = detectOutliers(makeNight({ ahi_total: 100 }), [makeNight(), makeNight()]);
    assert.deepEqual(result.flags, []);
});

test("outlier detection works normally with 3+ nights of history", () => {
    // History must have variance so std > 0 and z-scores can be computed
    const history = [
        makeNight({ ahi_total: 1 }),
        makeNight({ ahi_total: 2 }),
        makeNight({ ahi_total: 3 })
    ];
    const current = makeNight({ ahi_total: 100 }); // extreme outlier
    const result = detectOutliers(current, history);
    assert.ok(result.flags.some(f => f.metric === "ahi_total"), "expected ahi_total outlier flag");
});

test("no flags when current night has no therapy data", () => {
    const history = Array(10).fill(makeNight());
    const result = detectOutliers({ usage_hours: 0 }, history);
    assert.deepEqual(result.flags, []);
});
