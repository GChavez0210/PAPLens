import test from "node:test";
import assert from "node:assert/strict";
import { calculatePercentile, formatMetricValue, toMetricNumber } from "./therapyMetrics";

test("renderer calculatePercentile handles empty and interpolated values", () => {
    assert.equal(calculatePercentile([], 0.95), null);
    assert.equal(calculatePercentile([1, 3, 5, 7], 0.5), 4);
});

test("renderer metric coercion and formatting are stable", () => {
    assert.equal(toMetricNumber("12.5"), 12.5);
    assert.equal(toMetricNumber("bad"), null);
    assert.equal(formatMetricValue("12.345", 1), "12.3");
    assert.equal(formatMetricValue(null), "N/A");
});
