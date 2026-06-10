const test = require("node:test");
const assert = require("node:assert/strict");
const { validateMigrationIdentifier } = require("./database");

test("validateMigrationIdentifier accepts current migration identifiers", () => {
  assert.doesNotThrow(() => validateMigrationIdentifier("night_metrics", "pressure_histogram", "TEXT"));
  assert.doesNotThrow(() => validateMigrationIdentifier("derived_metrics", "therapy_stability_score", "REAL"));
  assert.doesNotThrow(() => validateMigrationIdentifier("night_metrics", "leak_spike_count", "INTEGER"));
});

test("validateMigrationIdentifier rejects unsafe SQL fragments", () => {
  assert.throws(
    () => validateMigrationIdentifier("night_metrics; DROP TABLE nights", "pressure_histogram", "TEXT"),
    /Invalid migration identifier/
  );
  assert.throws(
    () => validateMigrationIdentifier("night_metrics", "pressure histogram", "TEXT"),
    /Invalid migration identifier/
  );
  assert.throws(
    () => validateMigrationIdentifier("night_metrics", "pressure_histogram", "TEXT NOT NULL"),
    /Invalid migration identifier/
  );
});
