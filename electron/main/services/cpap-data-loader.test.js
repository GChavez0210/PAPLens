const test = require("node:test");
const assert = require("node:assert/strict");
const { CPAPDataLoader, normalizeTimeZone } = require("./cpap-data-loader");

test("getSleepNightKey honors an explicit timezone at the noon boundary", () => {
  const loader = new CPAPDataLoader("unused");
  loader.setDayBoundary(12, 12, "America/Denver");

  assert.equal(loader.getSleepNightKey("2026-03-08T17:59:00Z"), "2026-03-07");
  assert.equal(loader.getSleepNightKey("2026-03-08T18:00:00Z"), "2026-03-08");
});

test("getSleepNightKey remains timezone-explicit across DST fall-back", () => {
  const loader = new CPAPDataLoader("unused");
  loader.setDayBoundary(12, 12, "America/Denver");

  assert.equal(loader.getSleepNightKey("2026-11-01T18:59:00Z"), "2026-10-31");
  assert.equal(loader.getSleepNightKey("2026-11-01T19:00:00Z"), "2026-11-01");
});

test("normalizeTimeZone rejects invalid timezone names", () => {
  assert.equal(normalizeTimeZone("America/Denver"), "America/Denver");
  assert.equal(normalizeTimeZone("Not/AZone"), null);
});

test("setDayBoundary rejects invalid timezone names", () => {
  const loader = new CPAPDataLoader("unused");
  assert.throws(() => loader.setDayBoundary(12, 12, "Not/AZone"), /Invalid timezone/);
});
