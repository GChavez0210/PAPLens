const test = require("node:test");
const assert = require("node:assert/strict");

const shared = require("./metrics");
// The two former owners of this logic now re-export from src/shared, so importing
// them here proves the renderer and main process resolve to the same implementation.
const main = require("../../electron/main/services/therapyMetrics");

test("toOptionalNumber coerces only finite numbers", () => {
  assert.equal(shared.toOptionalNumber("12.5"), 12.5);
  assert.equal(shared.toOptionalNumber(""), null);
  assert.equal(shared.toOptionalNumber(null), null);
  assert.equal(shared.toOptionalNumber("NaN"), null);
  assert.equal(shared.toOptionalNumber(Infinity), null);
});

test("calculatePercentile interpolates and guards empty/single input", () => {
  assert.equal(shared.calculatePercentile([], 0.95), null);
  assert.equal(shared.calculatePercentile([7], 0.95), 7);
  assert.equal(shared.calculatePercentile([0, 10], 0.5), 5);
  assert.equal(shared.calculatePercentile([1, 2, 3, 4], 0.5), 2.5);
});

test("calculatePercentile ignores non-numeric samples", () => {
  assert.equal(shared.calculatePercentile([1, "x", null, 3], 0.5), 2);
});

test("calculatePercentilesFromSorted agrees with calculatePercentile", () => {
  const samples = [2, 9, 4, 1, 7, 3];
  const sorted = [...samples].sort((a, b) => a - b);
  const fromSorted = shared.calculatePercentilesFromSorted(sorted, [0.5, 0.95]);
  assert.equal(fromSorted[0.5], shared.calculatePercentile(samples, 0.5));
  assert.equal(fromSorted[0.95], shared.calculatePercentile(samples, 0.95));
});

test("formatMetricValue handles fixed, round, and missing values", () => {
  assert.equal(shared.formatMetricValue(3.14159, 2), "3.14");
  assert.equal(shared.formatMetricValue(3.6, 0, "round"), "4");
  assert.equal(shared.formatMetricValue(null), "N/A");
});

test("main process re-exports the shared implementation (no drift)", () => {
  assert.equal(main.toOptionalNumber, shared.toOptionalNumber);
  assert.equal(main.calculatePercentile, shared.calculatePercentile);
  assert.equal(main.calculatePercentilesFromSorted, shared.calculatePercentilesFromSorted);
});
