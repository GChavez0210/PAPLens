// Range-level summaries for the Insights "Findings" panel.
//
// Each stored explanation row describes a single night. Replaying one night's
// prose under a "Last 90 Days" heading answers the wrong question, so these
// summarisers read the whole range of nightly metrics and describe the period:
// how often the finding occurred, the typical value, and the worst night.
//
// They compose from live trend rows rather than the stored `summary` text, so a
// card can never show wording from an older analytics build.

import {
  FLOW_LIMITATION_MILD,
  FLOW_LIMITATION_SIGNIFICANT,
  MASK_FIT_MODERATE,
  MASK_FIT_POOR,
  RIN_ELEVATED,
  STABILITY_UNSTABLE,
  USAGE_COMPLIANCE_HOURS
} from "../constants";
import { PB_SEVERE_PCT, PB_SIGNIFICANT_PCT } from "./periodicBreathing";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// night_date is a plain YYYY-MM-DD key — parse the parts rather than going
// through Date(), which would read it as UTC midnight and shift the day west
// of Greenwich.
export function formatNightLabel(nightDate) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nightDate || "");
  if (!parts) return null;
  return `${MONTH_ABBR[Number(parts[2]) - 1]} ${Number(parts[3])}`;
}

const num = (value) => {
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed) ? null : parsed;
};

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Highest (or lowest) value of `selector` across nights, with the night it fell on. */
function extremeBy(nights, selector, { lowest = false } = {}) {
  let winner = null;
  for (const night of nights) {
    const value = num(selector(night));
    if (value === null) continue;
    if (!winner || (lowest ? value < winner.value : value > winner.value)) {
      winner = { value, date: night.night_date, night };
    }
  }
  return winner;
}

function valuesOf(nights, selector) {
  return nights.map((night) => num(selector(night))).filter((value) => value !== null);
}

const average = (values) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

const onDate = (date) => {
  const label = formatNightLabel(date);
  return label ? ` on ${label}` : "";
};

const METRIC_LABELS = {
  ahi_total: "AHI",
  usage_hours: "therapy usage",
  leak_p50: "median mask leak",
  leak_p95: "peak mask leak",
  pressure_median: "delivered pressure",
  minute_vent_p50: "minute ventilation",
  tidal_vol_p50: "tidal volume",
  resp_rate_p50: "respiratory rate",
  flow_limitation_p95: "flow limitation"
};

// Each summariser returns { title, text, worstDate } or null when the range
// holds no usable values for it. `nightCount` is how many nights actually
// produced the finding, counted by the query; `nights` is every night in range.
const SUMMARIZERS = {
  periodic_breathing(nights, { nightCount }) {
    const worst = extremeBy(nights, (n) => n.pb_pct);
    if (!worst) return null;

    const present = valuesOf(nights, (n) => n.pb_pct).filter((value) => value > 0);
    const avg = average(present);
    const episodes = num(worst.night.pb_episode_count);
    const confounded = worst.night.pb_leak_confounded === 1;

    const title =
      worst.value > PB_SEVERE_PCT
        ? "Severe Periodic Breathing"
        : worst.value >= PB_SIGNIFICANT_PCT
          ? "Periodic Breathing Detected"
          : "Mild Periodic Breathing";

    const frequency = `Detected on ${nightCount} of ${plural(nights.length, "night")}`;
    const typical = avg === null ? "" : `, occupying ${avg.toFixed(1)}% of the night on average`;
    const peak = `Worst was ${worst.value.toFixed(1)}%${onDate(worst.date)}${
      episodes !== null ? ` across ${plural(episodes, "episode")}` : ""
    }`;
    const verdict =
      worst.value >= PB_SIGNIFICANT_PCT
        ? ` — above the ${PB_SIGNIFICANT_PCT}% clinical threshold${
            confounded ? ", though that night's episodes overlapped mask leak" : ". Worth raising with your care team"
          }.`
        : `, still below the ${PB_SIGNIFICANT_PCT}% clinical threshold.`;

    return { title, text: `${frequency}${typical}. ${peak}${verdict}`, worstDate: worst.date };
  },

  flow_limitation(nights, { nightCount }) {
    const worst = extremeBy(nights, (n) => n.flow_limitation_p95);
    const worstRin = extremeBy(nights, (n) => n.rin_per_hr);
    if (!worst && !worstRin) return null;

    const peak = worst?.value ?? 0;
    const title =
      peak >= FLOW_LIMITATION_SIGNIFICANT
        ? "Significant Flow Limitation"
        : peak >= FLOW_LIMITATION_MILD
          ? "Mild Flow Limitation"
          : "Elevated Respiratory Disturbance";

    const parts = [`Flagged on ${nightCount} of ${plural(nights.length, "night")}.`];
    if (worst) {
      const avg = average(valuesOf(nights, (n) => n.flow_limitation_p95));
      parts.push(
        `Flow-limitation index peaked at ${worst.value.toFixed(2)}${onDate(worst.date)}` +
          (avg === null ? "" : `, against a range average of ${avg.toFixed(2)}`) +
          `.`
      );
    }
    if (worstRin && worstRin.value > RIN_ELEVATED) {
      parts.push(`RIN reached ${worstRin.value.toFixed(1)} events/hr${onDate(worstRin.date)}.`);
    }
    parts.push(
      peak >= FLOW_LIMITATION_SIGNIFICANT
        ? "Sustained narrowing at this level is worth discussing with your care team."
        : "Monitor for an upward trend."
    );

    return { title, text: parts.join(" "), worstDate: worst?.date ?? worstRin?.date ?? null };
  },

  stability(nights) {
    const worst = extremeBy(nights, (n) => n.stability_score, { lowest: true });
    if (!worst) return null;

    const scores = valuesOf(nights, (n) => n.stability_score);
    const avg = average(scores);
    const unstable = scores.filter((score) => score < STABILITY_UNSTABLE).length;

    if (unstable > 0) {
      return {
        title: "Inconsistent Therapy",
        text:
          `Stability fell below ${STABILITY_UNSTABLE} on ${unstable} of ${plural(scores.length, "scored night")}, ` +
          `bottoming out at ${worst.value.toFixed(0)}${onDate(worst.date)}. Range average ${avg.toFixed(0)}.`,
        worstDate: worst.date
      };
    }

    return {
      title: "Generally Stable",
      text:
        `Stability stayed at or above ${STABILITY_UNSTABLE} on all ${plural(scores.length, "scored night")}, ` +
        `averaging ${avg.toFixed(0)}. The lowest was ${worst.value.toFixed(0)}${onDate(worst.date)}.`,
      worstDate: worst.date
    };
  },

  mask_fit(nights) {
    const worst = extremeBy(nights, (n) => n.mask_fit_score, { lowest: true });
    if (!worst) return null;

    const scores = valuesOf(nights, (n) => n.mask_fit_score);
    const avg = average(scores);
    const poor = scores.filter((score) => score < MASK_FIT_POOR).length;
    const leaky = extremeBy(nights, (n) => n.leak_p95);

    const title =
      avg < MASK_FIT_POOR ? "Mask Fit Issues" : avg < MASK_FIT_MODERATE ? "Moderate Leaking" : "Good Mask Seal";

    const parts = [
      `Seal scored ${avg.toFixed(0)} on average across ${plural(scores.length, "night")}` +
        (poor > 0 ? `, dropping below ${MASK_FIT_POOR} on ${plural(poor, "night")}` : "") +
        `. Worst was ${worst.value.toFixed(0)}${onDate(worst.date)}.`
    ];
    if (leaky) {
      parts.push(`Peak leak reached ${leaky.value.toFixed(1)} L/min${onDate(leaky.date)}.`);
    }
    parts.push(
      avg < MASK_FIT_MODERATE
        ? "Check cushion wear and headgear tension."
        : "Leak stayed within a range that preserves therapy pressure."
    );

    return { title, text: parts.join(" "), worstDate: worst.date };
  },

  compliance(nights) {
    const usage = valuesOf(nights, (n) => n.usage_hours);
    if (usage.length === 0) return null;

    const worst = extremeBy(nights, (n) => n.usage_hours, { lowest: true });
    const avg = average(usage);
    const short = usage.filter((hours) => hours < USAGE_COMPLIANCE_HOURS).length;

    return {
      title: avg < USAGE_COMPLIANCE_HOURS ? "Usage Falling Behind" : "Usage Warning",
      text:
        `Averaged ${avg.toFixed(1)} hrs across ${plural(usage.length, "night")}, with ` +
        `${plural(short, "night")} under the ${USAGE_COMPLIANCE_HOURS}-hour compliance minimum. ` +
        `Shortest was ${worst.value.toFixed(1)} hrs${onDate(worst.date)}.`,
      worstDate: worst.date
    };
  },

  outlier(nights, { nightCount }) {
    let worst = null;
    for (const night of nights) {
      let flags;
      try {
        flags = night.outliers ? JSON.parse(night.outliers) : [];
      } catch {
        continue;
      }
      for (const flag of Array.isArray(flags) ? flags : []) {
        const z = num(flag?.z);
        if (z === null) continue;
        if (!worst || Math.abs(z) > Math.abs(worst.z)) {
          worst = { z, metric: flag.metric, date: night.night_date };
        }
      }
    }
    if (!worst) return null;

    const label = METRIC_LABELS[worst.metric] || worst.metric;
    const direction = worst.z > 0 ? "above" : "below";
    return {
      title: "Unusual Nights Detected",
      text:
        `${nightCount} of ${plural(nights.length, "night")} had readings well outside your usual pattern. ` +
        `The largest deviation was ${label}${onDate(worst.date)}, ` +
        `${Math.abs(worst.z).toFixed(1)} standard deviations ${direction} your baseline.`,
      worstDate: worst.date
    };
  }
};

/**
 * Build a range-level card body for one finding key.
 * Returns null for keys without a summariser so the caller can fall back to the
 * stored per-night text.
 */
export function summarizeFinding(key, nights, context) {
  const summarize = SUMMARIZERS[key];
  if (!summarize || !Array.isArray(nights) || nights.length === 0) return null;
  return summarize(nights, context) || null;
}
