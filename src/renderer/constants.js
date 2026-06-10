// Clinical thresholds used in severity/status logic across the app.
// Centralised here so every component reads from the same source of truth.

/** AHI threshold: below this is considered normal therapy control. */
export const AHI_MILD = 5;

/** AHI threshold: at or above this is moderate (above mild). */
export const AHI_MODERATE = 15;

/** Mask leak threshold (L/min): median leak at or above this is elevated. */
export const LEAK_HIGH = 24;

/** Mask leak threshold (L/min): median leak at or above this is critical (warning tier). */
export const LEAK_WARNING = 36;

/** Minimum nightly usage hours for CMS/insurance compliance. */
export const USAGE_COMPLIANCE_HOURS = 4;

/** Minimum nightly usage hours for the "warning" tier (below compliance but not critical). */
export const USAGE_WARNING_HOURS = 2;

/** Minimum SpO2 % considered normal. */
export const SPO2_NORMAL = 95;

/** Minimum SpO2 % before reaching critical tier. */
export const SPO2_WARNING = 90;
