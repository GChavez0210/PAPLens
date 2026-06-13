// Single source of truth for Chart.js styling across the app.
//
// Every chart (Overview TrendChart, the Insights charts, the daily session
// graphs) pulls its colors, grid, legend, tooltip and font config from here so
// they stay visually uniform and respond correctly to the light/dark theme.
//
// Before this helper existed, the Insights charts hardcoded dark-only colors
// (notably white gridlines that vanished on the light background), which is why
// they looked broken after the UI refresh added a light theme.

/**
 * Shared categorical series palette. Use these named colors instead of inlining
 * hex values so a series for the same metric reads the same color everywhere.
 */
export const SERIES = {
  red: "#ef4444",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  cyan: "#22d3ee",
  emerald: "#10b981",
  slate: "#64748b"
};

/** Translucent fill variants for area/bar fills (matches SERIES hues). */
export const SERIES_FILL = {
  red: "rgba(239,68,68,0.18)",
  blue: "rgba(59,130,246,0.20)",
  violet: "rgba(139,92,246,0.18)",
  amber: "rgba(245,158,11,0.16)",
  cyan: "rgba(34,211,238,0.18)",
  emerald: "rgba(16,185,129,0.18)",
  slate: "rgba(100,116,139,0.18)"
};

/**
 * Resolve the theme-dependent chrome colors (text, gridlines, axis border,
 * tooltip surface). `theme` is "light" | "dark".
 */
export function chartColors(theme) {
  const light = theme === "light";
  return {
    text: light ? "#475569" : "#cbd5e1",
    mutedText: light ? "#64748b" : "#94a3b8",
    grid: light ? "rgba(15,23,42,0.075)" : "rgba(226,232,240,0.11)",
    axis: light ? "rgba(15,23,42,0.16)" : "rgba(226,232,240,0.18)",
    track: light ? "rgba(15,23,42,0.06)" : "rgba(226,232,240,0.08)",
    tooltipBg: light ? "rgba(255,255,255,0.96)" : "rgba(24,24,27,0.96)",
    tooltipBorder: light ? "rgba(79,70,229,0.18)" : "rgba(255,255,255,0.14)",
    tooltipTitle: light ? "#0f172a" : "#ffffff"
  };
}

/**
 * Format a numeric axis tick cleanly: round to kill binary-float artifacts
 * (e.g. 0.6000000000000001 → "0.6") and trim trailing zeros. Non-numeric
 * values (category labels) pass through untouched.
 */
export function formatAxisTick(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return parseFloat(n.toFixed(2)).toString();
}

/** Bottom legend styled to match the refreshed look. */
export function baseLegend(theme, { fontSize = 11 } = {}) {
  const c = chartColors(theme);
  return {
    position: "bottom",
    labels: {
      color: c.text,
      boxWidth: 18,
      boxHeight: 3,
      padding: 14,
      usePointStyle: false,
      font: { size: fontSize, weight: "500" }
    }
  };
}

/** Tooltip surface styled to match the refreshed look. */
export function baseTooltip(theme) {
  const c = chartColors(theme);
  return {
    backgroundColor: c.tooltipBg,
    borderColor: c.tooltipBorder,
    borderWidth: 1,
    titleColor: c.tooltipTitle,
    bodyColor: c.text,
    displayColors: true,
    padding: 10,
    boxPadding: 4
  };
}

/**
 * A single x/y axis pair with consistent ticks, gridlines and axis border.
 * Spread the result into a chart's `scales` and override per-axis as needed.
 */
export function baseScales(theme, { fontSize = 11 } = {}) {
  const c = chartColors(theme);
  const ticks = { color: c.text, font: { size: fontSize, weight: "500" } };
  const grid = { color: c.grid, drawBorder: false, tickLength: 0 };
  const border = { color: c.axis };
  return {
    x: { ticks: { ...ticks, maxRotation: 42, minRotation: 0 }, grid, border },
    y: { beginAtZero: true, ticks: { ...ticks, callback: formatAxisTick }, grid, border }
  };
}
