// Periodic-breathing severity tiers, shared by every surface that colours a PB
// number — the Insights analysis card, the last-night detail bar, and the
// overview trend chart — so the three cannot drift apart.
//
// 5% of recording time is the clinical significance threshold; 20% is the top of
// the scale the Insights bar plots against and the point where the pattern
// dominates enough of the night to read as severe.
import { statusColors, withAlpha } from "../charts/chartTheme";

export const PB_SIGNIFICANT_PCT = 5;
export const PB_SEVERE_PCT = 20;

export function pbSeverity(pct) {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return "none";
  if (pct > PB_SEVERE_PCT) return "severe";
  if (pct >= PB_SIGNIFICANT_PCT) return "elevated";
  return "normal";
}

export const PB_SEVERITY_COLOR = {
  none: "var(--muted)",
  normal: "var(--ok)",
  elevated: "var(--watch)",
  severe: "var(--alert)"
};

/** CSS class that applies the severity's status color to a value. */
export const PB_SEVERITY_CLASS = {
  none: "is-muted",
  normal: "is-ok",
  elevated: "is-watch",
  severe: "is-alert"
};

export function pbColor(pct) {
  return PB_SEVERITY_COLOR[pbSeverity(pct)];
}

export function pbStatusClass(pct) {
  return PB_SEVERITY_CLASS[pbSeverity(pct)];
}

// Canvas cannot resolve CSS custom properties, so chart datasets need literal
// colours. These come from the same status palette the stylesheet uses, so the
// bars match the numbers beside them in both themes.
export function pbBarFill(pct, theme) {
  const severity = pbSeverity(pct);
  const status = statusColors(theme);
  const color =
    severity === "none" || severity === "normal" ? status.ok : severity === "elevated" ? status.watch : status.alert;
  return withAlpha(color, 0.55);
}

export function pbHex(pct, theme) {
  const severity = pbSeverity(pct);
  const status = statusColors(theme);
  return severity === "none" || severity === "normal"
    ? status.ok
    : severity === "elevated"
      ? status.watch
      : status.alert;
}
