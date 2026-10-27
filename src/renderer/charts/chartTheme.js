// Single source of truth for Chart.js styling across the app.
//
// Every chart (Overview TrendChart, the Insights charts, the daily session
// graphs) pulls its colors, grid, legend, tooltip and font config from here so
// they stay visually uniform and respond correctly to the light/dark theme.
//
// Canvas cannot resolve CSS custom properties, so this module holds literal
// values that mirror the tokens in styles.css. Keep the two in step: see
// docs/DESIGN_LANGUAGE.md.

/**
 * Categorical series palette, per theme. The hues are deliberately desaturated
 * — a chart of five full-saturation colors reads as decoration, a chart of five
 * muted ones reads as measurement.
 *
 * The keys are stable identities, not literal colors: use the same key for the
 * same metric everywhere so a series keeps its color across the app.
 */
const SERIES_DARK = {
  blue: "#6aa5de",
  clay: "#dd8a6c",
  sage: "#7bbd96",
  plum: "#a394d6",
  ochre: "#d4ae5c",
  teal: "#5fc0c6",
  slate: "#93a1b0"
};

const SERIES_LIGHT = {
  blue: "#2b6cb0",
  clay: "#b4553a",
  sage: "#4e8c6a",
  plum: "#6f5f9e",
  ochre: "#9a7a2e",
  teal: "#2f8c92",
  slate: "#5c6b7a"
};

/** Resolve the series palette for a theme ("light" | "dark"). */
export function seriesPalette(theme) {
  return theme === "light" ? SERIES_LIGHT : SERIES_DARK;
}

/** Translucent fill for an area or bar, from the same hue as the line. */
export function seriesFill(theme, key, alpha = 0.14) {
  return withAlpha(seriesPalette(theme)[key] ?? seriesPalette(theme).slate, alpha);
}

/** Convert a #rrggbb to rgba() at the given alpha. */
export function withAlpha(hex, alpha) {
  const value = String(hex).replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Clinical status colors for canvas. These mark a value's position against a
 * clinical range; they are never a series color.
 */
const STATUS_DARK = { ok: "#58bd8a", watch: "#d9a548", alert: "#e8827b", neutral: "#949ca6" };
const STATUS_LIGHT = { ok: "#1d7a4f", watch: "#8d5e08", alert: "#b3261e", neutral: "#656d77" };

export function statusColors(theme) {
  return theme === "light" ? STATUS_LIGHT : STATUS_DARK;
}

/**
 * Theme-dependent chrome: text, gridlines, axis border, tooltip surface.
 * Gridlines sit at roughly 6% contrast — present when you look for them,
 * invisible while you read the line.
 */
export function chartColors(theme) {
  const light = theme === "light";
  return {
    text: light ? "#656d77" : "#949ca6",
    mutedText: light ? "#818992" : "#7d858f",
    grid: light ? "rgba(26, 30, 36, 0.06)" : "rgba(233, 236, 239, 0.06)",
    axis: light ? "rgba(26, 30, 36, 0.14)" : "rgba(233, 236, 239, 0.12)",
    track: light ? "#e1e5ea" : "#272d34",
    tooltipBg: light ? "#ffffff" : "#21272e",
    tooltipBorder: light ? "#c6cdd5" : "#3a424b",
    tooltipTitle: light ? "#1a1e24" : "#e9ecef"
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

/** Bottom legend: a short rule per series, not a filled chip. */
export function baseLegend(theme, { fontSize = 11 } = {}) {
  const c = chartColors(theme);
  return {
    position: "bottom",
    labels: {
      color: c.text,
      boxWidth: 14,
      boxHeight: 2,
      padding: 14,
      usePointStyle: false,
      font: { size: fontSize, weight: "400" }
    }
  };
}

/** Tooltip surface, matched to the app's popover style. */
export function baseTooltip(theme) {
  const c = chartColors(theme);
  return {
    backgroundColor: c.tooltipBg,
    borderColor: c.tooltipBorder,
    borderWidth: 1,
    titleColor: c.tooltipTitle,
    titleFont: { size: 12, weight: "600" },
    bodyColor: c.text,
    bodyFont: { size: 11, weight: "400" },
    displayColors: true,
    boxWidth: 8,
    boxHeight: 8,
    cornerRadius: 7,
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
  const ticks = { color: c.text, font: { size: fontSize, weight: "400" }, padding: 6 };
  const grid = { color: c.grid, drawBorder: false, tickLength: 0 };
  const border = { color: c.axis };
  return {
    x: { ticks: { ...ticks, maxRotation: 42, minRotation: 0 }, grid: { ...grid, display: false }, border },
    y: { beginAtZero: true, ticks: { ...ticks, callback: formatAxisTick }, grid, border }
  };
}
