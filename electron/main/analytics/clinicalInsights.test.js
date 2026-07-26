const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyLeakSeverity, computeMaskFitScore } = require("./clinicalInsights");
const { MASK_FIT_POOR, MASK_FIT_MODERATE } = require("../../../src/shared/clinicalThresholds");

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

// computeMaskFitScore — the orchestrator wrote a hardcoded null here for long
// enough that the mask-fit finding could never fire, so these pin the contract
// the findings narrative and the PDF report both read.

test("mask fit: a clean seal scores in the Good Mask Seal band", () => {
  const score = computeMaskFitScore({ leak_p95: 3, leak_p50: 1, usage_hours: 7.5 });
  assert.ok(score >= MASK_FIT_MODERATE, `expected >= ${MASK_FIT_MODERATE}, got ${score}`);
});

test("mask fit: leak past the severe p95 tier lands in the Mask Fit Issues band", () => {
  const score = computeMaskFitScore({ leak_p95: 40, leak_p50: 20, usage_hours: 7 });
  assert.ok(score < MASK_FIT_POOR, `expected < ${MASK_FIT_POOR}, got ${score}`);
});

test("mask fit: a leaky baseline scores worse than the same peak off a clean median", () => {
  // Identical p95; only the median differs. A p95-only score could not tell
  // a persistent leak apart from one brief excursion.
  const spiky = computeMaskFitScore({ leak_p95: 20, leak_p50: 1, usage_hours: 7 });
  const persistent = computeMaskFitScore({ leak_p95: 20, leak_p50: 14, usage_hours: 7 });
  assert.ok(persistent < spiky, `expected persistent (${persistent}) < spiky (${spiky})`);
});

test("mask fit: score is null when no leak data was recorded", () => {
  assert.equal(computeMaskFitScore({ usage_hours: 7 }), null);
  assert.equal(computeMaskFitScore({ leak_p95: null, leak_p50: null, usage_hours: 7 }), null);
});

test("mask fit: a measured zero leak is a perfect seal, not missing data", () => {
  assert.equal(computeMaskFitScore({ leak_p95: 0, leak_p50: 0, usage_hours: 7 }), 100);
});

test("mask fit: never returns 0, which the report builder reads as missing data", () => {
  const score = computeMaskFitScore({ leak_p95: 500, leak_p50: 400, leak_spike_count: 900, usage_hours: 7 });
  assert.ok(score >= 1, `expected floor of 1, got ${score}`);
});

test("mask fit: seal breaks are counted per hour, not per night", () => {
  // Same break rate over a longer night must not score worse.
  const shortNight = computeMaskFitScore({ leak_p95: 8, leak_p50: 3, leak_spike_count: 4, usage_hours: 4 });
  const longNight = computeMaskFitScore({ leak_p95: 8, leak_p50: 3, leak_spike_count: 8, usage_hours: 8 });
  assert.equal(shortNight, longNight);
});
