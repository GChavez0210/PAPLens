// Clinical thresholds used in severity/status logic across the app.
// The single source of truth is src/shared/clinicalThresholds.js (shared with
// electron/main/analytics/clinicalInsights.js). This file re-exports the
// renderer-facing subset so renderer components keep importing from "./constants".
export {
  AHI_MILD,
  AHI_MODERATE,
  LEAK_HIGH,
  LEAK_WARNING,
  USAGE_COMPLIANCE_HOURS,
  USAGE_WARNING_HOURS,
  SPO2_NORMAL,
  SPO2_WARNING
} from "../shared/clinicalThresholds";
