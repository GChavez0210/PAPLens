"use strict";

// Single source of truth for clinical thresholds, shared by:
//   - the renderer, via src/renderer/constants.js (re-exports the renderer-facing
//     subset as named ESM exports), and
//   - the main process, via electron/main/analytics/clinicalInsights.js.
// Edit values here only. Authored as CommonJS so both module systems can consume
// it (renderer through Vite/esbuild interop, main through require).

// AHI (events/hr).
const AHI_MILD = 5;
const AHI_MODERATE = 15;

// Mask leak display tiers (L/min). LEAK_HIGH intentionally equals the p95 "severe"
// leak tier below — they are the same clinical number kept side by side here so
// they cannot silently diverge.
const LEAK_HIGH = 24;
const LEAK_WARNING = 36;

// Usage (hours/night).
const USAGE_COMPLIANCE_HOURS = 4;
const USAGE_WARNING_HOURS = 2;

// Oximetry (%).
const SPO2_NORMAL = 95;
const SPO2_WARNING = 90;

// Leak severity tiers consumed by classifyLeakSeverity. Calibrated for
// 95th-percentile leak; the median (p50) scale is ~half because leak
// distributions are right-skewed (see DATA-9). Tier mapping: severe -> 3,
// high -> 2, mild -> 1, otherwise 0.
const LEAK_SEVERITY_P95 = { severe: 24, high: 12, mild: 5 };
const LEAK_SEVERITY_P50 = { severe: 12, high: 6, mild: 2.5 };

module.exports = {
  AHI_MILD,
  AHI_MODERATE,
  LEAK_HIGH,
  LEAK_WARNING,
  USAGE_COMPLIANCE_HOURS,
  USAGE_WARNING_HOURS,
  SPO2_NORMAL,
  SPO2_WARNING,
  LEAK_SEVERITY_P95,
  LEAK_SEVERITY_P50
};
