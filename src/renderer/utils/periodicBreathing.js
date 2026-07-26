// Periodic-breathing severity tiers, shared by every surface that colours a PB
// number — the Insights analysis card, the last-night detail bar, and the
// overview trend chart — so the three cannot drift apart.
//
// 5% of recording time is the clinical significance threshold; 20% is the top of
// the scale the Insights bar plots against and the point where the pattern
// dominates enough of the night to read as severe.
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
  normal: "var(--success)",
  elevated: "var(--warning)",
  severe: "var(--critical)"
};

export function pbColor(pct) {
  return PB_SEVERITY_COLOR[pbSeverity(pct)];
}

// Canvas cannot resolve CSS custom properties, so chart datasets need literal
// colours. These track the dark-theme values of the vars above, matching how the
// other overview trend charts hardcode their series colours. The translucent set
// fills the bars; the solid set is their hover state.
export const PB_SEVERITY_BAR = {
  none: "rgba(34,197,94,0.55)",
  normal: "rgba(34,197,94,0.55)",
  elevated: "rgba(245,158,11,0.65)",
  severe: "rgba(244,63,94,0.7)"
};

export const PB_SEVERITY_HEX = {
  none: "#22c55e",
  normal: "#22c55e",
  elevated: "#f59e0b",
  severe: "#f43f5e"
};

export function pbBarFill(pct) {
  return PB_SEVERITY_BAR[pbSeverity(pct)];
}

export function pbHex(pct) {
  return PB_SEVERITY_HEX[pbSeverity(pct)];
}
