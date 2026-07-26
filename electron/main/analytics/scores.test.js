const test = require("node:test");
const assert = require("node:assert/strict");
const { computeTherapyStabilityScore, computeComplianceRisk } = require("./scores");

test("low usage applies a usage penalty so the stability score is not 100", () => {
  const result = computeTherapyStabilityScore({
    usage_hours: 2.9,
    ahi_total: 0,
    leak_p95: 1,
    pressure_median: 10,
    pressure_p95: 10
  });

  // Reported to 1 decimal so the breakdown matches the score it produced (100 − 12.3).
  assert.equal(result.penaltyUsage, 12.3);
  assert.equal(result.stabilityScore, 87.7);
});

test("missing flow limitation data stays null instead of forcing a zero-derived score", () => {
  const result = computeTherapyStabilityScore({
    usage_hours: 6,
    ahi_total: 0.5,
    leak_p95: 4,
    pressure_median: 10,
    pressure_p95: 11
  });

  assert.equal(result.penaltyFlowLim, null);
  assert.equal(result.flScore, null);
});

test("flow limitation p95 contributes a deterministic penalty when present", () => {
  const result = computeTherapyStabilityScore({
    usage_hours: 7,
    ahi_total: 0.5,
    leak_p95: 4,
    pressure_median: 10,
    pressure_p95: 11,
    flow_limitation_p95: 0.22
  });

  assert.equal(result.penaltyFlowLim, 3);
  assert.equal(result.flScore, 60);
});

// DATA-2: zero-usage nights must not be dropped from compliance calculation
test("compliance risk is high when patient used device only 2 of 14 nights", () => {
  // newest-first: 2 used nights followed by 12 zeros
  const usage = [8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const risk = computeComplianceRisk(usage);
  assert.equal(risk, "high");
});

test("compliance risk is low for consistent nightly use", () => {
  const usage = Array(14).fill(7);
  const risk = computeComplianceRisk(usage);
  assert.equal(risk, "low");
});

// DATA-8: pressureSpread is returned (not pressureSd alias)
test("pressureVariance field reflects p95-median spread", () => {
  const result = computeTherapyStabilityScore({
    usage_hours: 7,
    ahi_total: 1,
    leak_p95: 4,
    pressure_median: 10,
    pressure_p95: 13
  });
  assert.equal(result.pressureVariance, 3); // 13 - 10
});

test("history baseline changes therapy stability score when at least 7 nights are supplied", () => {
  const current = {
    usage_hours: 7,
    ahi_total: 5,
    leak_p95: 4,
    pressure_median: 10,
    pressure_p95: 11
  };
  const history = [1, 1.1, 1.2, 1.1, 1.2, 1.3, 1.1].map((ahi_total) => ({
    usage_hours: 7,
    ahi_total,
    leak_p95: 4,
    pressure_median: 10,
    pressure_p95: 11
  }));

  const withoutHistory = computeTherapyStabilityScore(current);
  const withHistory = computeTherapyStabilityScore(current, history);

  assert.ok(withHistory.stabilityScore < withoutHistory.stabilityScore);
  assert.ok(withHistory.penaltyHistoricalBaseline > 0);
});

// DATA-14: missingFields names every tracked metric absent after fallbacks.
test("missingFields lists only the metrics that resolved to null", () => {
  const complete = computeTherapyStabilityScore({
    usage_hours: 7,
    ahi_total: 1,
    leak_p95: 4,
    pressure_median: 10,
    pressure_p95: 13,
    rin_per_hr: 2,
    flow_limitation_p95: 0.05
  });
  assert.deepEqual(complete.missingFields, []);

  // Usage + AHI present; leak chain, pressure pair, RIN, and flow limitation absent.
  const sparse = computeTherapyStabilityScore({ usage_hours: 7, ahi_total: 3 });
  assert.deepEqual(
    sparse.missingFields.sort(),
    ["flow_limitation_p95", "leak", "pressure_spread", "rin_per_hr"].sort()
  );

  // leak_p50 satisfies the leak fallback chain, so "leak" is not reported missing.
  const leakViaFallback = computeTherapyStabilityScore({ usage_hours: 7, ahi_total: 3, leak_p50: 8 });
  assert.equal(leakViaFallback.missingFields.includes("leak"), false);

  // A night with no therapy data at all reports every tracked field as missing.
  const noData = computeTherapyStabilityScore({});
  assert.deepEqual(
    noData.missingFields.sort(),
    ["ahi_total", "flow_limitation_p95", "leak", "pressure_spread", "rin_per_hr", "usage"].sort()
  );
});
