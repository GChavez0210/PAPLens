"use strict";

// Pure metric helpers shared by BOTH processes:
//   - the renderer (ESM) imports these through Vite/esbuild's CJS interop, and
//   - the main process (CJS) requires them directly.
// Authored as CommonJS so a single source works in both module systems without a
// build step. Keep this file free of DOM, React, Electron, and Node-only APIs so
// it stays portable. (Shared because the renderer and main copies of these
// functions previously drifted — see DATA-8/DATA-9.)

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeMetricSamples(values) {
  return (values || [])
    .map((value) => toOptionalNumber(value))
    .filter((value) => value !== null);
}

// Linear interpolation between sorted samples. Caller guarantees the array is
// already sanitized and ascending-sorted. Empty input stays null so missing data
// is never masked as 0. `minSamples` (default 1) returns null when there are too
// few samples for the percentile to be meaningful — pass a higher value (e.g. 10)
// for tail percentiles like p95 so a "p95" of one epoch isn't reported as a real
// statistic (DATA-10).
function percentileFromSorted(sortedSamples, percentile, { minSamples = 1 } = {}) {
  const length = sortedSamples ? sortedSamples.length : 0;
  if (length === 0 || length < minSamples) {
    return null;
  }

  if (length === 1) {
    return sortedSamples[0];
  }

  const bounded = Math.min(1, Math.max(0, percentile));
  const index = (length - 1) * bounded;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedSamples[lowerIndex];
  }

  const weight = index - lowerIndex;
  return sortedSamples[lowerIndex] + (sortedSamples[upperIndex] - sortedSamples[lowerIndex]) * weight;
}

function calculatePercentilesFromSorted(sortedSamples, percentiles, options = {}) {
  const result = {};
  for (const percentile of percentiles || []) {
    result[percentile] = percentileFromSorted(sortedSamples, percentile, options);
  }
  return result;
}

// Sanitizes, sorts, then interpolates. Use calculatePercentilesFromSorted when
// computing several percentiles off one array to avoid re-sorting (see PERF-5).
function calculatePercentile(values, percentile, { minSamples = 1 } = {}) {
  const samples = sanitizeMetricSamples(values);
  if (samples.length === 0 || samples.length < minSamples) {
    return null;
  }

  if (samples.length === 1) {
    return samples[0];
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return percentileFromSorted(sorted, percentile);
}

function formatMetricValue(value, digits = 1, rounding = "fixed") {
  const numeric = toOptionalNumber(value);
  if (numeric === null) {
    return "N/A";
  }

  return rounding === "round" ? String(Math.round(numeric)) : numeric.toFixed(digits);
}

module.exports = {
  toOptionalNumber,
  sanitizeMetricSamples,
  percentileFromSorted,
  calculatePercentilesFromSorted,
  calculatePercentile,
  formatMetricValue
};
