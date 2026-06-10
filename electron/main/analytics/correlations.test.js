const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCorrelations, pearsonPValue } = require("./correlations");

test("pearsonPValue returns a significant p-value for a strong correlation", () => {
    const p = pearsonPValue(0.9, 10);
    assert.ok(p !== null && p < 0.001, `expected p < 0.001, got ${p}`);
});

test("reported correlations include n, pValue, and significant", () => {
    const nights = Array.from({ length: 10 }, (_, i) => ({
        usage_hours: 7,
        ahi_total: i + 1,
        leak_p50: i + 1,
        pressure_median: 10,
    }));

    const result = analyzeCorrelations(nights);
    const leakAhi = result.find((item) => item.x === "Leak" && item.y === "AHI");
    assert.ok(leakAhi, "expected leak/AHI correlation");
    assert.equal(leakAhi.n, 10);
    assert.equal(leakAhi.significant, true);
    assert.ok(leakAhi.pValue < 0.05);
});
