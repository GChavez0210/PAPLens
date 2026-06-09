const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyLeakSeverity } = require("./clinicalInsights");

// DATA-9: when only leak_p50 is available the function must use median-scale thresholds,
// not the p95 thresholds, so severity is not systematically under-flagged.

test("p95 basis: leak95=25 is tier 3 (severe)", () => {
    const result = classifyLeakSeverity(25, 10, 240, { basis: "p95" });
    assert.equal(result.tier, 3);
    assert.equal(result.basis, "p95");
});

test("p95 basis: leak95=10 is tier 1 (mild)", () => {
    const result = classifyLeakSeverity(10, 5, 240, { basis: "p95" });
    assert.equal(result.tier, 1);
});

test("p50 basis: leak50=13 is tier 3 using median thresholds", () => {
    // With p95 thresholds, 13 would only be tier 2 — median thresholds correctly escalate
    const result = classifyLeakSeverity(13, 13, 240, { basis: "p50" });
    assert.equal(result.tier, 3);
    assert.equal(result.basis, "p50");
});

test("p50 basis: leak50=7 is tier 2 using median thresholds", () => {
    const result = classifyLeakSeverity(7, 7, 240, { basis: "p50" });
    assert.equal(result.tier, 2);
});

test("null leak value returns null tier regardless of basis", () => {
    const result = classifyLeakSeverity(null, null, 240);
    assert.equal(result.tier, null);
});

test("usage < 60 min returns tier 0 regardless of leak value", () => {
    const result = classifyLeakSeverity(50, 30, 30, { basis: "p95" });
    assert.equal(result.tier, 0);
});

test("p95 basis: clamped when p95 < p50 (swapped percentiles)", () => {
    // leak_p95 supplied as 5 but leak_p50 is 20 — corrupted data; should escalate tier
    const result = classifyLeakSeverity(5, 20, 240, { basis: "p95" });
    assert.ok(result.tier >= 2, `expected tier ≥ 2 after clamp, got ${result.tier}`);
});
