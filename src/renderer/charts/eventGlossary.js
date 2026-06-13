// Plain-English glossary for the markers and flags drawn on the daily session
// graphs. Each entry feeds two surfaces:
//   - `tip`   — a single short line appended to the Chart.js hover tooltip.
//   - `what` / `action` — the longer copy shown in the pinned info popover
//     (ChartInfoPopover) when a marker is clicked.
//
// The PB entry mirrors the wording already used by PeriodicBreathingCard so the
// daily graphs and the Insights card stay consistent.

/**
 * Canonical glossary keyed by event family. `accent` matches the marker colour
 * used on the chart (see eventColor in SessionGraphsModal) so the popover reads
 * as the same thing the user clicked.
 */
export const EVENT_GLOSSARY = {
  obstructive: {
    title: "Obstructive Apnea",
    accent: "#ef4444",
    tip: "Airway physically collapsed despite breathing effort",
    what: "An obstructive apnea is a near-complete blockage of the upper airway lasting at least 10 seconds. The chest and diaphragm keep trying to breathe, but the collapsed airway lets little or no air through.",
    action: "Occasional events are normal. Frequent obstructive apneas may mean therapy pressure is too low to splint the airway open — worth raising with your care team if the nightly count trends up."
  },
  central: {
    title: "Central Apnea",
    accent: "#8b5cf6",
    tip: "Brain briefly paused the signal to breathe — no effort",
    what: "A central (clear-airway) apnea is a pause of at least 10 seconds in which there is no breathing effort at all — the airway is open, but the brain momentarily stops sending the drive to breathe.",
    action: "A few are common, especially at sleep onset and during pressure changes. Persistent or clustered central apneas can point to central respiratory instability and are worth discussing with your physician."
  },
  hypopnea: {
    title: "Hypopnea",
    accent: "#f59e0b",
    tip: "Airflow dropped ≥30% for 10+ seconds (partial blockage)",
    what: "A hypopnea is a partial narrowing of the airway where airflow falls by roughly 30% or more for at least 10 seconds, usually with a drop in oxygen or a brief arousal. It is a milder cousin of an apnea.",
    action: "Hypopneas count toward your AHI. A rising hypopnea share can indicate the airway is narrowing but not fully collapsing — sometimes addressed by a pressure adjustment."
  },
  rera: {
    title: "RERA",
    accent: "#22d3ee",
    tip: "Effort-related arousal — flow limited but below apnea level",
    what: "A respiratory-effort-related arousal (RERA) is a sequence of increasingly flow-limited breaths that ends in a brief awakening, without meeting the airflow-drop criteria for an apnea or hypopnea.",
    action: "RERAs fragment sleep even though they don't count toward AHI. Frequent RERAs can leave you unrefreshed and may suggest residual upper-airway resistance."
  },
  leak: {
    title: "Large Leak",
    accent: "#10b981",
    tip: "Mask leak high enough to compromise therapy/data",
    what: "A large-leak flag marks a stretch where air escaping around the mask exceeded the level your device can compensate for, which can reduce delivered pressure and make event detection less reliable.",
    action: "Check mask fit, cushion wear, and strap tension. Leak-heavy periods can also make other events in the same window less trustworthy."
  },
  apnea: {
    title: "Apnea",
    accent: "#ef4444",
    tip: "Breathing stopped for 10+ seconds (cause unclassified)",
    what: "An apnea is a near-complete stop in airflow lasting at least 10 seconds. This event was scored without classifying it as specifically obstructive or central.",
    action: "Occasional apneas are normal. A rising count can mean therapy isn't fully controlling your breathing — worth raising with your care team if it trends up."
  },
  periodic_breathing: {
    title: "Periodic Breathing Episode",
    accent: "#f59e0b",
    tip: "Cyclic waxing-and-waning breathing pattern",
    what: "Periodic breathing is a cyclic pattern where breath size alternates between deep and shallow (or brief pauses), typically on a 30–120 second cycle. During sleep, especially with central pauses at the low point, it is called Cheyne-Stokes respiration and can be associated with heart failure, stroke, or altitude.",
    action: "Periodic breathing above ~5% of recording time is considered clinically significant. If it recurs, share it with your sleep physician or cardiologist — it can sometimes be addressed by optimizing pressure or switching to adaptive servo-ventilation (ASV)."
  }
};

/**
 * Resolve a raw event annotation string (e.g. "Obstructive Apnea", "H", "CA")
 * to its glossary entry, or `null` when the annotation isn't a respiratory
 * event we can describe (e.g. "Recording starts" or other device markers).
 * Callers skip null entries so meaningless markers are never plotted.
 * Mirrors the matching order used by eventColor so the popover and the marker
 * colour always agree.
 */
export function glossaryForEvent(text) {
  const value = String(text || "").toLowerCase();
  if (value.includes("obstructive") || value === "oa") return EVENT_GLOSSARY.obstructive;
  if (value.includes("central") || value.includes("clear airway") || value === "ca") return EVENT_GLOSSARY.central;
  if (value.includes("hypopnea") || value === "h") return EVENT_GLOSSARY.hypopnea;
  if (value.includes("rera")) return EVENT_GLOSSARY.rera;
  if (value.includes("leak")) return EVENT_GLOSSARY.leak;
  if (value.includes("apnea") || value === "a") return EVENT_GLOSSARY.apnea;
  return null;
}

/** Glossary entry for periodic-breathing episodes. */
export function glossaryForPB() {
  return EVENT_GLOSSARY.periodic_breathing;
}
