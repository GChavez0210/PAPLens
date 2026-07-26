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

// Therapy stability score (0-100) below which a night reads as inconsistent
// rather than stable.
const STABILITY_UNSTABLE = 70;

// Mask-fit score (0-100, higher is a better seal) tiers used by the findings
// narrative. The report builder's getMaskFitTier adds finer display bands on top
// of these, but shares the 60 boundary.
const MASK_FIT_POOR = 60;
const MASK_FIT_MODERATE = 80;

// Flow limitation index (0-1, 95th percentile) and RIN (events/hr).
const FLOW_LIMITATION_MILD = 0.1;
const FLOW_LIMITATION_SIGNIFICANT = 0.3;
const RIN_ELEVATED = 5;

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
  STABILITY_UNSTABLE,
  MASK_FIT_POOR,
  MASK_FIT_MODERATE,
  FLOW_LIMITATION_MILD,
  FLOW_LIMITATION_SIGNIFICANT,
  RIN_ELEVATED,
  LEAK_SEVERITY_P95,
  LEAK_SEVERITY_P50
};
