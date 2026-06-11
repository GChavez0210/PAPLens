const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCorrelations, pearsonPValue, rankValues, spearmanRho } = require("./correlations");

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
    assert.equal(leakAhi.method, "spearman");
    assert.equal(leakAhi.rho, leakAhi.r);
    assert.equal(leakAhi.significant, true);
    assert.ok(leakAhi.pValue < 0.05);
});

test("rankValues assigns averaged ranks for ties", () => {
    assert.deepEqual(rankValues([10, 20, 20, 40]), [1, 2.5, 2.5, 4]);
});

test("spearmanRho captures monotonic skewed relationships as the headline value", () => {
    const rho = spearmanRho([1, 2, 3, 4, 100], [1, 4, 9, 16, 25]);
    assert.equal(rho, 1);

    const nights = [
        { leak_p50: 1, ahi_total: 1, pressure_median: 8, usage_hours: 7 },
        { leak_p50: 2, ahi_total: 4, pressure_median: 9, usage_hours: 7 },
        { leak_p50: 3, ahi_total: 9, pressure_median: 10, usage_hours: 7 },
        { leak_p50: 4, ahi_total: 16, pressure_median: 11, usage_hours: 7 },
        { leak_p50: 100, ahi_total: 25, pressure_median: 12, usage_hours: 7 }
    ];
    const result = analyzeCorrelations(nights);
    const leakAhi = result.find((item) => item.x === "Leak" && item.y === "AHI");
    assert.equal(leakAhi.method, "spearman");
    assert.equal(leakAhi.r, leakAhi.rho);
    assert.ok(leakAhi.pearsonR < leakAhi.rho);
});
