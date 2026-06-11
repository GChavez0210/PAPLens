const test = require("node:test");
const assert = require("node:assert/strict");
const { detectChronicMissingFields } = require("./diagnostics");

function nightsMissing(field, count, startDay = 1) {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-01-${String(startDay + i).padStart(2, "0")}`,
    missingFields: [field]
  }));
}

function silentLogger() {
  const warnings = [];
  return { warnings, warn: (msg) => warnings.push(msg) };
}

test("does not flag a field missing for exactly the threshold", () => {
  const logger = silentLogger();
  const result = detectChronicMissingFields(nightsMissing("leak", 10), { logger });
  assert.deepEqual(result, []);
  assert.equal(logger.warnings.length, 0);
});

test("flags a field missing for more than the threshold and warns once", () => {
  const logger = silentLogger();
  const result = detectChronicMissingFields(nightsMissing("leak", 11), { logger });
  assert.equal(result.length, 1);
  assert.equal(result[0].field, "leak");
  assert.equal(result[0].consecutiveNights, 11);
  assert.equal(result[0].startDate, "2026-01-01");
  assert.equal(result[0].endDate, "2026-01-11");
  assert.equal(logger.warnings.length, 1);
});

test("a present night resets the run", () => {
  const logger = silentLogger();
  const sequence = [
    ...nightsMissing("leak", 8, 1),
    { date: "2026-01-09", missingFields: [] }, // leak present again
    ...nightsMissing("leak", 8, 10)
  ];
  const result = detectChronicMissingFields(sequence, { logger });
  assert.deepEqual(result, []);
});

test("tracks each field independently", () => {
  const sequence = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-02-${String(i + 1).padStart(2, "0")}`,
    missingFields: i < 12 ? ["flow_limitation_p95"] : []
  }));
  // Add 'leak' missing only on the first 3 nights — should not flag.
  sequence[0].missingFields.push("leak");
  sequence[1].missingFields.push("leak");
  sequence[2].missingFields.push("leak");

  const result = detectChronicMissingFields(sequence, { logger: silentLogger() });
  assert.equal(result.length, 1);
  assert.equal(result[0].field, "flow_limitation_p95");
});

test("respects a custom threshold and tolerates a missing logger", () => {
  const result = detectChronicMissingFields(nightsMissing("usage", 4), { threshold: 3, logger: null });
  assert.equal(result.length, 1);
  assert.equal(result[0].consecutiveNights, 4);
});
