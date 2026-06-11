"use strict";

// Analytics self-diagnostics. Scans a chronological sequence of per-night
// missing-field reports (from computeTherapyStabilityScore's `missingFields`) and
// warns when the same metric stays missing for more than `threshold` consecutive
// nights — the signature of a systematic parser/device gap rather than the odd
// skipped night (DATA-14).

const DEFAULT_THRESHOLD = 10;

function safeWarn(logger, message) {
  if (!logger || typeof logger.warn !== "function") {
    return;
  }
  try {
    logger.warn(message);
  } catch {
    // Diagnostic logging must never interrupt analytics.
  }
}

// perNightMissing: array of { date, missingFields: string[] } in chronological order.
// Returns one entry per field that crossed the threshold: { field, consecutiveNights,
// startDate, endDate }. A field whose run resets (present again) can be reported again
// if it later relapses.
function detectChronicMissingFields(perNightMissing, { threshold = DEFAULT_THRESHOLD, logger = console } = {}) {
  const runs = new Map(); // field -> { count, startDate }
  const warned = new Set(); // fields already warned for the current run
  const chronic = [];

  for (const night of perNightMissing || []) {
    const date = night && night.date != null ? night.date : null;
    const missing = new Set(Array.isArray(night && night.missingFields) ? night.missingFields : []);

    // Visit every field we are currently tracking plus any newly missing this night.
    const fields = new Set([...runs.keys(), ...missing]);
    for (const field of fields) {
      if (missing.has(field)) {
        const prev = runs.get(field);
        const run = prev && prev.count > 0
          ? { count: prev.count + 1, startDate: prev.startDate }
          : { count: 1, startDate: date };
        runs.set(field, run);

        if (run.count > threshold && !warned.has(field)) {
          warned.add(field);
          chronic.push({ field, consecutiveNights: run.count, startDate: run.startDate, endDate: date });
          safeWarn(
            logger,
            `[analytics] Metric "${field}" missing for ${run.count} consecutive nights ` +
            `(since ${run.startDate ?? "unknown"}) — likely a systematic parser/device gap, ` +
            "not an occasional skipped night."
          );
        }
      } else {
        // Field present again: reset the run and allow a fresh warning on relapse.
        runs.set(field, { count: 0, startDate: null });
        warned.delete(field);
      }
    }
  }

  return chronic;
}

module.exports = { detectChronicMissingFields, DEFAULT_THRESHOLD };
