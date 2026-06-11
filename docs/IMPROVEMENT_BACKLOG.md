# PAPLens Improvement Backlog

A reviewed, prioritized list of fixes and improvements across security, data-analysis
correctness, performance, and code efficiency. Each task is written to be self-contained
so it can be assigned independently (to a developer or an AI model) without extra context.

Conventions:
- **ID** — stable reference for assignment (e.g., "implement SEC-1").
- **Priority** — P0 (do first, correctness/safety), P1 (high value), P2 (nice to have).
- **Effort** — S (< 1 hr), M (1–4 hrs), L (multi-session).
- Line numbers were verified against the repo as of commit `994a293` and have since drifted
  substantially (Waves 1–4 are largely implemented). Search for the quoted code instead of
  trusting any line number.
- After every task: run `npm test` and `npm run lint`; add or update a unit test when the
  task touches `electron/main/**` (those modules already have Vitest-style `*.test.js`
  siblings — follow that pattern).

---

## 1. Security

### SEC-1 (P0, S) — Harden `addColumnIfNotExists` migration helper against SQL injection
**Status:** Done 2026-06-10.
**File:** `electron/main/services/database.js:215-225`
`table`, `column`, and `type` are interpolated directly into `pragma(\`table_info(${table})\`)`
and `ALTER TABLE ${table} ADD COLUMN ${column} ${type}`. All current call sites
(lines 227+) are hardcoded literals, so this is not exploitable today, but it is a loaded
footgun if the helper is ever reused with dynamic input.
**Fix:** Validate all three parameters against a strict identifier regex before use:
`if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(column) || !/^(REAL|INTEGER|TEXT)$/.test(type)) throw new Error("Invalid migration identifier");`
Do not change any call sites; they all pass the validation.

### SEC-2 (P0, S) — Add uncompressed-size limits to the ZIP reader (zip-bomb defense)
**Status:** Done 2026-06-10.
**File:** `electron/main/parsers/zip-reader.js` (extraction path, ~lines 50-75)
ZIP entries are inflated with no cap on declared uncompressed size or total entries. A
crafted SD-card archive (10 MB → 100 GB) crashes the app.
**Fix:** Before inflating each entry, read its declared `uncompressedSize` from the central
directory and throw if it exceeds 200 MB; also cap total entries at 10,000 and cumulative
uncompressed bytes at 1 GB. After `inflateRawSync`, verify the actual output length matches
the declared size (reject if it is larger). Add a test with a small entry whose declared
size exceeds the cap.

### SEC-3 (P1, S) — Add Content-Security-Policy to both HTML entry points
**Status:** Done 2026-06-11.
**Files:** `index.html`, `report.html`
Neither file declares a CSP, so any renderer XSS could load remote scripts.
**Fix:** Add to `<head>` of both files:
`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;">`
Then run the app (`npm run dev`) and the PDF report flow and check the devtools console for
CSP violations; adjust only the specific directive that breaks (Vite dev mode may need
`'unsafe-inline'` for script in dev only — gate it via a template variable if so).

### SEC-4 (P1, S) — Validate `folderPath` in the `cpap:load-data-folder` IPC handler
**Status:** Done 2026-06-10.
**File:** `electron/main/services/ipcRouter.js:47-56`
The renderer-supplied `folderPath` flows into filesystem operations with only an existence
check. Defense in depth: reject malformed input at the boundary.
**Fix:** At the top of the handler, return `{ success: false, error: "Invalid folder path" }`
unless: `typeof folderPath === "string"`, `path.isAbsolute(path.normalize(folderPath))`,
and `fs.statSync(folderPath).isDirectory()` (in try/catch). Mirror the validation style used
by the UUID checks in `app:delete-profile` (line ~352).

### SEC-5 (P1, S) — Bound EDF header integer fields against memory exhaustion
**Status:** Done 2026-06-10.
**File:** `electron/main/parsers/edf-parser.js:26-43`
`numSignals`, `numDataRecords`, and per-signal `samplesPerRecord` come from the untrusted
file and drive loop bounds / allocations with no sanity caps.
**Fix:** In `parseHeader`, after parsing: throw `new Error("EDF header out of range")` if
`numSignals` is not in 1..256, `numDataRecords` not in 0..2,000,000, or `headerBytes`
disagrees with `256 + numSignals * 256`. When reading signal headers, throw if any
`samplesPerRecord` exceeds 100,000. Also verify the buffer is long enough for
`headerBytes + numDataRecords * recordSize` before reading records. Add a test with a
header claiming `numSignals = 99999`.

### SEC-6 (P2, S) — Sanity-check Electron dependency version and add audit script
**Status:** Done 2026-06-11. Latest Electron was checked, but the app remains on 39.8.10 because Electron 42.4.0 failed the `better-sqlite3` native rebuild during packaging.
**File:** `package.json`
The pinned `electron` version should be verified against current stable releases, and there
is no audit step.
**Fix:** Run `npm outdated electron better-sqlite3 handlebars` and bump to current stable
majors if behind (test `npm run dev` + a full import after bumping). Add
`"audit": "npm audit --audit-level=high"` to scripts and run it in the release workflow
before build steps.

### SEC-7 (P2, S) — Escape user-entered profile fields fed into the report template
**Status:** Done 2026-06-10.
**Files:** `src/renderer/utils/reportBuilder.js`, `report.html`
Handlebars `{{ }}` auto-escapes, which is currently safe. Make this resilient to future
template edits.
**Fix:** Grep `report.html` for `{{{` and remove any triple-stash around user data (none
expected today). In `reportBuilder.js`, coerce profile name/notes with
`String(value ?? "")` and document with a one-line comment that the template must never use
triple-stash for these fields. Add a unit test that renders the template with a profile
name of `<script>alert(1)</script>` and asserts the output contains `&lt;script&gt;`.

---

## 2. Data-analysis correctness

### DATA-1 (P0, S) — Fix `computeTherapyStabilityScore` ignored second argument
**Status:** Done 2026-06-10. Implemented option (b): history z-normalizes the penalty inputs when `history.length >= 7`; both call sites pass `history30`.
**Files:** `electron/main/analytics/orchestrator.js:78`, `electron/main/services/ipcRouter.js:253`, `electron/main/analytics/scores.js:10`
Both call sites pass `(current, history30)` but the function signature is
`computeTherapyStabilityScore(currentMetrics)` — the history argument is silently dropped,
so any intended historical baselining never happens.
**Fix (decide one):** (a) If history is not needed, delete the second argument at both call
sites and add a comment; (b) preferred: extend the function to accept
`(currentMetrics, history = [])` and use history to z-normalize the penalty inputs when
`history.length >= 7`. Option (a) is safe and mechanical; option (b) needs a test asserting
the score changes when history is supplied.

### DATA-2 (P0, S) — Compliance risk ignores skipped (zero-usage) nights
**Status:** Done 2026-06-10. Zero-usage nights are now mapped to `0` instead of filtered out.
**File:** `electron/main/analytics/scores.js:101-113`
`computeComplianceRisk` filters `v > 0` before slicing the last 7/14 entries, so nights the
patient skipped therapy entirely are removed from a *compliance* metric — a patient using
the device 2 nights out of 14 can still look low-risk. (Note: the `.reverse()` on line 109
is correct — input arrives newest-first from `dataAccess.get14DaysUsage` and is reversed to
chronological before the slope; do not "fix" that.)
**Fix:** Keep zero-usage nights as `0` instead of filtering them out: replace the filter
with `.map(v => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)`, and return
`null` only when the array is empty. Update/extend `scores.test.js` with a case of
`[8,8,0,0,0,0,0, 8,8,8,8,8,8,8]` (newest-first) asserting "high" risk.

### DATA-3 (P0, S) — Require n ≥ 3 for Pearson correlation
**Status:** Done 2026-06-10. `pearsonR` returns `null` for n<3 or variance below EPSILON; `correlations.js` skips null pairs and reports `n`.
**Files:** `electron/main/analytics/regression.js:26`, `electron/main/analytics/correlations.js`
`pearsonR` returns a value for n = 2, where r is always ±1 and meaningless; correlations.js
then labels it with clinical strength wording.
**Fix:** In `pearsonR`, return `null` when `n < 3` or when either variance is below
`EPSILON`; in `correlations.js`, skip any pair whose r is `null` and include the sample
count `n` in each reported correlation object. Add tests for n=2 and zero-variance inputs.

### DATA-4 (P1, M) — Add significance (p-value) and n to reported correlations
**Status:** Done 2026-06-10. Incomplete-beta `betacf`/`betai` t-CDF added (no new dependency); each correlation carries `{ n, pValue, significant }` and the Insights renderer labels non-significant rows.
**File:** `electron/main/analytics/correlations.js:19-33`
Strength labels (weak/mild/moderate/strong) use only |r| thresholds; with n ≈ 10-30 nights,
"mild" correlations are frequently noise being presented as clinical insight.
**Fix:** Compute `t = r * sqrt((n-2)/(1-r*r))` and a two-sided p-value from the t
distribution (implement the incomplete-beta-based CDF locally — no new dependency; ~30
lines, see Numerical Recipes `betacf`/`betai`). Attach `{ n, pValue }` to each correlation,
and suppress (or label "not significant") any with `pValue >= 0.05`. Update the renderer
(`src/renderer/pages/Insights.jsx` correlations section) to show n and hide non-significant
rows. Add tests with known r/n/p triples.

### DATA-5 (P1, M) — Return R² and slope standard error from `regressionSlope`
**Status:** Done 2026-06-10. `regressionSlope` now returns `{ slope, intercept, r2, se, n }`; thin `regressionSlopeValue()` wrapper preserves legacy numeric callers.
**File:** `electron/main/analytics/regression.js:3-22` (and consumers in `scores.js`, `orchestrator.js`)
Trend slopes are reported with no measure of fit, so a slope explaining 5% of variance is
treated the same as one explaining 95%.
**Fix:** Change `regressionSlope` to return `{ slope, intercept, r2, se, n }` (keep a thin
`regressionSlopeValue()` wrapper returning just the slope so existing call sites keep
working, then migrate call sites one by one). In trend consumers, treat a trend as
reportable only when `n >= 7 && r2 >= 0.3`. Add tests: perfect line (r2 = 1), pure noise
(r2 ≈ 0).

### DATA-6 (P1, S) — Don't flag outliers with fewer than 3 history nights
**Status:** Done 2026-06-10. `detectOutliers` returns empty below 3 valid history nights; `zScore` returns `null` when `sigma <= EPSILON` and callers skip null z-scores.
**File:** `electron/main/analytics/outliers.js` (+ `electron/main/analytics/rolling.js:14-16`)
With 0-1 nights of history, `std()` returns 0 and `zScore()` clamps sigma to EPSILON (1e-9),
producing astronomically inflated z-scores — a patient's first nights get false "outlier"
flags.
**Fix:** In `detectOutliers`, return `{ flags: [], z_scores: {} }` when valid history
length < 3. In `rolling.js`, make `zScore` return `null` when `sigma <= EPSILON` instead of
clamping, and make callers skip null z-scores. Add a test: first-night metrics with empty
history produce zero flags.

### DATA-7 (P1, M) — Fix periodic-breathing episode gap-merging off-by-one
**Status:** Done 2026-06-10. Merge loop rewritten to track `{ epStart, lastFlagged }`; episodes close at `end = lastFlagged`, so boundaries land on flagged samples only.
**File:** `electron/main/analytics/periodicBreathing.js:86-111`
When a gap exceeds `MAX_GAP_SAMPLES`, the episode end index is computed as `i - gapRun`
(and `N - 1 - gapRun` at end-of-signal), which can place the episode boundary inside the
gap, inflating episode duration and letting sub-threshold episodes pass the
`MIN_EPISODE_SAMPLES` check.
**Fix:** Rewrite the merge loop to track `{ start, lastFlagged }` explicitly: open an
episode at the first flagged sample; on each flagged sample update `lastFlagged`; when
`i - lastFlagged > MAX_GAP_SAMPLES` (or at end of input), close the episode with
`end = lastFlagged` and keep it only if `lastFlagged - start + 1 >= MIN_EPISODE_SAMPLES`.
Add unit tests: flags `[T,T,T, F×gap, T,T,T]` with gap just under and just over the
threshold, asserting episode boundaries land on flagged samples only.

### DATA-8 (P1, S) — Rename and recalibrate the pressure "variance" metric
**Status:** Done 2026-06-10. Renamed to `pressureSpread` with the "p95 − median, ≈1.35σ" comment; thresholds documented on the spread scale.
**File:** `electron/main/analytics/scores.js:49-60`
`pressureSd = pressure_p95 - pressure_median` is a percentile spread, not a standard
deviation (≈1.35σ for normal data), but the penalty thresholds treat it as σ.
**Fix:** Rename the local variable and any persisted/reported field to `pressureSpread`
(keep the DB column name as-is; just map it), add a comment "p95 − median spread, ≈1.35σ
for normal data", and re-derive thresholds: if the current penalty triggers at spread > 2,
document why or adjust to the intended σ-equivalent (2 cmH₂O σ ≙ ~2.7 spread). Update
`scores.test.js` expectations accordingly.

### DATA-9 (P1, S) — Leak threshold fallback uses the wrong percentile scale
**Status:** Done 2026-06-10. `classifyLeakSeverity` tracks `basis` (p95 vs p50) and applies median-scale thresholds when only `leak_p50` is available.
**File:** `electron/main/analytics/clinicalInsights.js` (~lines 9-20)
Severity thresholds are calibrated for 95th-percentile leak (`leak95 > 24`), but the
fallback chain can substitute the median (`leak_p50`) into the same comparison,
under-flagging leak severity by roughly 2x.
**Fix:** Track which field was actually used: if only `leak_p50` is available, compare
against a median-scale threshold (`> 12`) and tag the insight with
`basis: "median"` so the UI can qualify it. Also clamp `leak95 = Math.max(leak95, leak50)`
when both exist, to guard corrupted/swapped percentiles.

### DATA-10 (P2, S) — Guard single-sample percentiles
**Status:** Done 2026-06-11. Added a `minSamples` option (default 1) to the shared percentile helpers; `summarizeNightlySessionMetrics` now suppresses p95-type metrics below 10 samples (median keeps the default) and returns a `sampleCounts` map per metric. `sampleCounts` is persisted as `night_metrics.sample_counts`, reused for cached imports, and surfaced on hydrated nightly summary objects.
**File:** `electron/main/services/therapyMetrics.js:52-74`
`calculatePercentile` happily returns a "95th percentile" of one sample. Downstream
summaries present these as real statistics.
**Fix:** Add a `minSamples` option (default 1 to preserve behavior), and have nightly
summaries (`sessionMetrics.js` callers) pass `minSamples: 10` for p95-type metrics,
returning `null` below that. Include `sampleCount` in the returned nightly metric objects
so the UI can show data-confidence. Update tests.

### DATA-11 (P2, M) — Make sleep-night assignment timezone-explicit
**Status:** Done 2026-06-11. ResMed sleep-night assignment now accepts an optional IANA `timeZone` through the existing sleep-boundary control and IPC path, persisted as a renderer preference. `getSleepNightKey` uses `Intl.DateTimeFormat(..., { timeZone })` for hour/date parts, preserves host-local behavior when blank, rejects invalid timezone names, and has noon/DST boundary tests.
**File:** `electron/main/services/cpap-data-loader.js:224-235` (`getSleepNightKey`)
Night assignment uses the host machine's local time interpretation of session timestamps.
If data was recorded in another timezone (travel, machine clock vs analysis machine), nights
shift by a day around the noon cutoff. DST transitions can also reassign edge sessions.
**Fix:** Document the current assumption with a comment first. Then add an optional
`timeZone` setting (persist via the existing settings table, default = system), and compute
the hour-of-day via `new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false })`
instead of `Date#getHours`. Add tests around the noon boundary and a DST transition date.

### DATA-12 (P2, M) — Deduplicate metric logic shared by renderer and main
**Status:** Done 2026-06-11. Pure helpers (`toOptionalNumber`, percentile math, `formatMetricValue`) moved to CJS `src/shared/metrics.js`; the renderer (`utils/therapyMetrics.js`) and main (`services/therapyMetrics.js`) are thin re-export shims. Clinical thresholds centralized in `src/shared/clinicalThresholds.js`, consumed by `constants.js` (renderer) and `clinicalInsights.js` (main) — this closes the REND-8 coordination gap. Notes: `src/shared/**/*` added to the electron-builder `files` glob (main runs from source and requires it at runtime); `vite.config.mjs` `commonjsOptions.include` extended so the Rollup production build resolves the CJS named exports; `run-node-tests.js` now discovers `src/shared/*.test.js`. Added `src/shared/metrics.test.js` asserting main and shared resolve to the same implementation.
**Files:** `src/renderer/utils/therapyMetrics.js`, `electron/main/services/therapyMetrics.js`
`toOptionalNumber`, percentile math, and formatting exist in both processes and can diverge
silently (a past source of the kind of bugs in DATA-8/9).
**Fix:** Create `src/shared/metrics.js` exporting the pure functions; import from the
renderer via ESM and from `electron/main` (CJS) — either convert the shared file to a
dual-compatible module or add `"type"` handling per Vite/Electron build config (the Vite
alias for the renderer and a plain `require` path for main both work if the file uses CJS
`module.exports` and the renderer imports it through Vite's CJS interop). Keep the two old
files as thin re-export shims for one release. Run both test suites.

### DATA-13 (P2, L) — Add Spearman correlation and use it for skewed metrics
**Status:** Done 2026-06-11. `correlations.js` now rank-transforms paired samples with averaged tie ranks, reuses `pearsonR` to compute Spearman `rho`, stores both `rho` and `pearsonR`, and reports Spearman as the headline `r`/`method: "spearman"` value. Tests cover tie ranks and a monotone nonlinear skewed pair.
**File:** `electron/main/analytics/regression.js` (new function), `correlations.js`
AHI and leak distributions are right-skewed; Pearson understates/overstates monotone
relationships under skew and is outlier-sensitive.
**Fix:** Implement `spearmanR(x, y)` (rank-transform with average ranks for ties, then call
the existing `pearsonR` on ranks). In `correlations.js`, compute both and report Spearman
as the headline value for AHI/leak pairs, keeping Pearson in the payload. Tests: a perfect
monotone nonlinear pair (Spearman 1, Pearson < 1) and a tie-heavy case.

### DATA-14 (P2, S) — Track which metric fields were missing per night
**Status:** Done 2026-06-11. `computeTherapyStabilityScore` returns `missingFields: string[]` (every tracked metric null after its fallback chain). New `electron/main/analytics/diagnostics.js` (`detectChronicMissingFields`) warns once when a field is missing >10 consecutive nights; the orchestrator scans stored therapy-night history through the latest processed date so incremental imports catch streaks that started earlier.
**File:** `electron/main/analytics/scores.js` (fallback chains throughout)
Null metrics fall through `??` chains silently, so systematic parser failures (e.g., leak_p95
never populated for a device) are invisible.
**Fix:** In `computeTherapyStabilityScore`, build a `missingFields: string[]` array naming
every metric that resolved to null after fallbacks, and return it on the score object. Have
`diagnostics.js` log a warning when the same field is missing for >10 consecutive nights.

---

## 3. Performance

### PERF-1 (P0, M) — Wrap nightly metric building to release per-night sample arrays
**Status:** Done 2026-06-10. Loop groups by night, accumulates into a per-night `aggregate`, summarizes, and stores only the summary so raw arrays drop out of scope each iteration.
**File:** `electron/main/services/cpap-data-loader.js:342-400` (`buildNightlySessionMetrics`)
A Map accumulates raw sample arrays (9+ metrics) for *every* night before any
summarization. A multi-year dataset holds tens of millions of numbers simultaneously —
GC stalls and OOM risk on 4 GB machines.
**Fix:** Restructure the loop to group sessions by night first (cheap — just keys), then
for each night: parse that night's session files, accumulate into a local `aggregate`
object, call the existing summarizer, store only the summary, and let the raw arrays go out
of scope before the next night. Behavior must be identical — verify by importing a sample
dataset before/after and diffing the stored night metrics.

### PERF-2 (P0, S) — Stop sending full raw waveform arrays over IPC
**Status:** Done 2026-06-10. `downsampleSignal` caps each signal via stride sampling and sends `downsampled`/`originalLength`/`stride` alongside `sampleCounts`.
**File:** `electron/main/services/cpap-data-loader.js:299-304` (`loadSessionDetail`)
`detail.data[fileType].rawData = parsed.data` ships every parsed sample array to the
renderer (can be 10+ MB per session) even though `sampleCounts` metadata is sent alongside.
**Fix:** First, find every renderer consumer of `rawData` (grep `rawData` under
`src/renderer/` — `SessionGraphsModal.jsx` is the likely one). If the renderer plots these
signals, add a max-points cap: downsample each signal to ≤ 2,000 points in the main process
(simple stride sampling: `Math.ceil(len / 2000)`) before sending, and include
`downsampled: true` + original length. If a consumer needs full resolution later, add a
dedicated `cpap:get-signal` IPC handler that returns one signal at a time.

### PERF-3 (P0, S) — Enable WAL mode and NORMAL synchronous on SQLite
**Status:** Done 2026-06-10. `journal_mode = WAL` + `synchronous = NORMAL` set immediately after open.
**File:** `electron/main/services/database.js` (`init()`, near the existing
`foreign_keys` pragma at ~line 15)
Default journal mode makes bulk imports 2-3x slower than necessary.
**Fix:** Add `this.db.pragma("journal_mode = WAL");` and
`this.db.pragma("synchronous = NORMAL");` immediately after the database is opened.
Note: WAL creates `-wal`/`-shm` sidecar files next to the DB; confirm nothing (backup or
profile-delete logic) copies/deletes the DB file by exact name only — if it does, include
the sidecars.

### PERF-4 (P1, M) — Convert import-path sync I/O to async
**Status:** Done 2026-06-10. Import-path `readdirSync`/`statSync`/`readFileSync` converted to `fs.promises`; `parseSTRFile` made async. Worker-thread EDF parser offload was completed later under PERF-9.
**Files:** `electron/main/services/cpap-data-loader.js:149-158` (readdirSync loop over
DATALOG date dirs), `electron/main/services/incremental-import.js:45-48` (statSync loop),
`electron/main/parsers/edf-parser.js:10-13` (`parse()` uses readFileSync — make sure the
sync entry point isn't used on the import path; `parseSTRFile` at cpap-data-loader.js:136
currently is), plus loaders: `electron/main/loaders/resvent-loader.js:77,170,228` and the
analogous readFileSync calls in the other vendor loaders (`fisher-paykel-loader.js`,
`bmc-loader.js`, `yuwell-loader.js`, `apex-loader.js`, `prisma-line-loader.js`,
`devilbiss-loader.js`, `lowenstein-loader.js` — grep `readFileSync|readdirSync|statSync`).
These block the main process event loop for the duration of large imports, freezing all
IPC and the UI.
**Fix:** Mechanical conversion inside already-async methods: `fs.readdirSync` →
`await fs.promises.readdir`, `fs.statSync` → `await fs.promises.stat`,
`fs.readFileSync` → `await fs.promises.readFile`. Make `parseSTRFile` async (it already has
an async sibling `parseSessionFileAsync` to copy from) and await it at
cpap-data-loader.js:136. Keep per-directory work sequential (don't `Promise.all` hundreds
of readdirs at once — batch with a concurrency of ~8). Run the loader test suites after.

### PERF-5 (P1, S) — Sort once per metric, compute all percentiles from the sorted array
**Status:** Done 2026-06-10. `calculatePercentilesFromSorted` added and used by the nightly/`_finalizeDay` paths; a test asserts both paths agree.
**Files:** `electron/main/services/therapyMetrics.js:52-74` (`calculatePercentile` sorts on
every call), `electron/main/services/sessionMetrics.js:108-143` (calls it ~10x per night),
`electron/main/loaders/resvent-loader.js:282-295` (same pattern in `_finalizeDay`)
Each percentile call copies and re-sorts the same array — O(k · n log n) per night where one
sort suffices.
**Fix:** Add `calculatePercentilesFromSorted(sortedSamples, [..percentiles])` (export from
therapyMetrics.js) that takes a pre-sanitized, pre-sorted array and returns a map of
percentile → value using the existing interpolation math. Update
`summarizeNightlySessionMetrics` and `_finalizeDay` to sanitize + sort each metric array
once and call the new function. Keep `calculatePercentile` for external callers. Existing
tests must pass unchanged; add one asserting both paths agree.

### PERF-6 (P1, S) — Skip STR.edf re-parse when the file hasn't changed
**Status:** Done 2026-06-10. STR.edf `mtimeMs`+`size` cached under `str_edf_mtime`/`str_edf_size`; parse is skipped and stored summaries reused on match.
**File:** `electron/main/services/cpap-data-loader.js:136-139` + `incremental-import.js`
STR.edf (one record per device-day, grows for years) is fully re-parsed on every refresh
even when unchanged — the existing incremental import already tracks DATALOG dir mtimes
(see incremental-import.js:45), but not STR.edf.
**Fix:** Stat STR.edf, compare `mtimeMs` + `size` against values cached in the settings
table (`str_edf_mtime`, `str_edf_size` keys, using the same get/set helpers
incremental-import.js uses for directory mtimes); skip parsing and reuse stored summaries on
match, update the cache after a successful parse.

### PERF-7 (P1, M) — Batch the per-night analytics queries (N+1)
**Status:** Done 2026-06-10. `dataAccess.getNightsRange` fetches all nights once; the orchestrator derives 30-night/14-day/30-day windows by slicing the in-memory array.
**File:** `electron/main/analytics/orchestrator.js:58-66`, `electron/main/analytics/dataAccess.js`
For each night the orchestrator issues 4 separate queries (`getNight`,
`getNightHistoryMatrix`, `get14DaysUsage`, `get30DaysAHI`) — 4 × N round-trips per
analytics run.
**Fix:** Add a `dataAccess.getNightsRange(deviceId, fromDate, toDate)` that fetches all
nights + metrics in one query ordered by date, then derive each night's 30-night history /
14-day usage / 30-day AHI windows in JS by slicing the in-memory array (the windows are
just trailing slices of the same ordered data). Keep the old methods for other callers.
Verify outputs are byte-identical for a sample device before/after.

### PERF-8 (P2, S) — Add covering index for the night-hydration join
**Status:** Done 2026-06-10. `idx_night_metrics_night_id` created on `night_metrics(night_id)`.
**File:** `electron/main/services/database.js` (schema section, ~lines 106-211)
Startup hydration joins `nights` to `night_metrics` filtered by `device_id` ordered by
`night_date`.
**Fix:** After the migration block, add
`CREATE INDEX IF NOT EXISTS idx_night_metrics_night_id ON night_metrics(night_id);` (verify
with `EXPLAIN QUERY PLAN` on the hydration query in `cpapService.js` ~line 265 that the join
no longer scans). Indexes on `nights(device_id, night_date)` already exist — don't
duplicate them.

### PERF-9 (P2, M) — Move EDF parsing to a worker thread
**Status:** Done 2026-06-11. The async EDF parser entry points now offload file read + parse work to a `worker_threads` worker using the parser module itself as the worker script; synchronous parser APIs remain unchanged. Added coverage for the worker-backed async parse path.
**Files:** `electron/main/parsers/edf-parser.js`, new `electron/main/parsers/edf-parser-worker.js`
Even fully async, parsing + sample aggregation is CPU work on the main process, making the
app sluggish during big imports. Do this *after* PERF-1/PERF-4 — it may be unnecessary once
I/O and memory issues are fixed.
**Fix:** Create a worker that accepts a file path, runs `parseBuffer`, and posts back the
parsed result (use `worker_threads`; transfer large arrays as `Float64Array` via
transferable `ArrayBuffer`s to avoid structured-clone cost). Pool 2 workers max. Gate behind
a try/catch fallback to in-process parsing.

### PERF-10 (P2, S) — Trim and stage the import-complete IPC payload
**Status:** Done 2026-06-10. `measureSummaryPayload` instruments the summary byte size/counts (with a test); splitting deferred until a measurement exceeds the ~1 MB threshold.
**File:** `electron/main/services/cpapService.js` (~line 111, `cpap:data-loaded` summary)
The summary includes the full `dailyStats` array (365+ × ~30 fields) plus 50 session
objects in one message.
**Fix:** Measure first: log `JSON.stringify(summary).length`. If > ~1 MB for a year of
data, split: send the summary without `dailyStats`, and have the renderer fetch
`dailyStats` via the existing stats IPC call it already uses on other paths. If < 1 MB,
close this task as won't-fix with the measurement noted.

### PERF-11 (P2, S) — Finalize each Resvent day as soon as it's complete
**Status:** Done 2026-06-10. `_finalizeDay` is now called inline as each day completes instead of in an end-of-load pass.
**File:** `electron/main/loaders/resvent-loader.js:156-158, 188-194`
Every day's raw `_leakSamples`/`_mvSamples`/etc. arrays are kept until all days are loaded,
then finalized in a second pass.
**Fix:** Since days are processed in date order, call `this._finalizeDay(day)` (which
replaces sample arrays with summary stats — also delete the `_*Samples` properties there)
immediately after the last session file of each day is parsed, instead of in the
end-of-load loop. Apply the same pattern to any other vendor loader with a deferred
finalize pass.

---

## 4. Renderer / React efficiency

### REND-1 (P1, S) — Wrap all chart components in `React.memo`
**Status:** Done 2026-06-10. All seven chart components plus `TrendChart` are memoized (done together with REND-2).
**Files:** `src/renderer/components/charts/*.jsx` (AHITrendChart, EventTypeSplitChart,
FlowLimitationChart, LeakSeverityGauge, PressureHistogramChart, TherapyStabilityCard,
PeriodicBreathingCard), `src/renderer/charts/TrendChart.jsx`
None are memoized, so every parent state change re-renders (and re-creates Chart.js
instances for) all charts.
**Fix:** Wrap each component export in `React.memo(...)`. This only pays off if props are
referentially stable — do REND-2 in the same change.

### REND-2 (P1, M) — Stabilize chart props and stop rebuilding Chart.js instances
**Status:** Done 2026-06-10. Parents build `data`/`options` in `useMemo`; `TrendChart` creates the chart once (deps `[type]`) and mutates/`update()`s in a separate effect, destroying only on unmount.
**Files:** `src/renderer/App.jsx` (chart usage ~lines 807-899),
`src/renderer/charts/TrendChart.jsx:11-93`,
`src/renderer/components/SessionGraphsModal.jsx:296-363`
Inline `options`/`data` objects passed to charts get new identities each render, defeating
memo and causing destroy/recreate of Chart.js instances (flicker, lost tooltip/zoom state).
**Fix:** (1) In parents, build chart `data`/`options` inside `useMemo` keyed on the actual
inputs (theme, arrays). (2) In `TrendChart`, split the effect: create the Chart once on
mount, and in a second effect mutate `chart.data` / `chart.options` and call
`chart.update()` when props change; destroy only on unmount.

### REND-3 (P1, S) — Memoize derived data and kill redundant sorts in App.jsx
**Status:** Done 2026-06-10. `filteredStats`/`trendsData`/threshold arrays hoisted into `useMemo`s; inline `.some()` scans replaced with memoized booleans.
**File:** `src/renderer/App.jsx:233-288`
`filteredStats` sorts the same array up to 3 times; `trendsData` recomputes O(n·window)
rolling averages and rebuilds constant threshold arrays on every dependency tick;
`Insights.jsx:484,496,565` runs `.some()` scans inline in JSX.
**Fix:** Sort once and derive the filtered slice from the sorted array; hoist
`rollingAvg` results and `Array(n).fill(threshold)` into their own `useMemo`s; replace the
inline `.some()` calls with memoized booleans. No behavior change — verify charts render
identically.

### REND-4 (P1, S) — Add an ErrorBoundary around tab content and modals
**Status:** Done 2026-06-10. `ErrorBoundary.jsx` added and wrapped per region (tab content, modal, Insights).
**File:** `src/renderer/App.jsx` (new `src/renderer/components/ErrorBoundary.jsx`)
Any render-time throw currently blanks the whole app with no recovery.
**Fix:** Add a standard class-based ErrorBoundary (with a "Reload" button and
`console.error` of the error) and wrap: the active tab's content, `SessionGraphsModal`, and
the Insights page. Keep one boundary per region so a chart crash doesn't kill navigation.

### REND-5 (P1, S) — Lazy-load the Insights page
**Status:** Done 2026-06-10. `Insights` loaded via `React.lazy` + `Suspense`.
**File:** `src/renderer/App.jsx` (top-level `import Insights from "./pages/Insights"`)
Insights (600+ lines + its chart deps) is bundled into the initial load though it renders
on one tab.
**Fix:** `const Insights = React.lazy(() => import("./pages/Insights"));` and wrap its
render site in `<Suspense fallback={<div className="loading">Loading…</div>}>`. Confirm the
Vite build emits a separate chunk.

### REND-6 (P1, S) — Fix `loadData` identity / effect deps in Insights
**Status:** Done 2026-06-10. `loadData` wrapped in `useCallback` with a `cancelled`/`isCancelled` stale-response guard.
**File:** `src/renderer/pages/Insights.jsx:251-271`
`loadData` is recreated each render and triggers `getInsights()` IPC calls more often than
the inputs (range, customFrom, customTo) change.
**Fix:** Wrap `loadData` in `useCallback([range, customFrom, customTo])`, reference it from
the effect with `[loadData]` deps, and add an `AbortController`-style stale-response guard
(`let cancelled = false; ... if (!cancelled) setState(...)`; return `() => { cancelled = true; }`).

### REND-7 (P2, M) — Downsample chart datasets beyond ~400 points
**Status:** Done 2026-06-10. `utils/downsample.js` helper added and applied in `trendsData`.
**Files:** `src/renderer/App.jsx` (trendsData), chart components
"All time" ranges pass every nightly point to Chart.js; multi-year data makes tooltips and
resize janky.
**Fix:** Add a small LTTB (largest-triangle-three-buckets) helper in
`src/renderer/utils/downsample.js` (~40 lines, no dependency) and apply it in `trendsData`
when series length > 400, targeting 300 points. Keep raw data for the expanded/zoomed chart
view if one exists.

### REND-8 (P2, M) — Replace per-render inline styles and magic numbers
**Status:** Done 2026-06-10. Clinical thresholds hoisted into `src/renderer/constants.js`; coordinated with `clinicalInsights.js` via the shared `src/shared/clinicalThresholds.js` source of truth (completed under DATA-12, 2026-06-11).
**File:** `src/renderer/App.jsx` (65+ `style={{...}}` instances; thresholds 5/15/24/95
scattered; delays 280/1500 ms)
**Fix:** Move static style objects either to `styles.css` classes or to module-level
`const` objects (identity-stable). Hoist clinical thresholds into a single
`src/renderer/constants.js` (`AHI_MILD = 5`, `AHI_MODERATE = 15`, `LEAK_HIGH = 24`, …) and
import them — coordinate names with the same thresholds in
`electron/main/analytics/clinicalInsights.js` (and with DATA-12's shared module if done).

### REND-9 (P2, M) — Replace fixed `setTimeout` waits in report generation
**Status:** Done 2026-06-10. Empty-stats bail-out and `computeScores` null-check added; capture polls for chart readiness instead of fixed waits.
**File:** `src/renderer/App.jsx` (~lines 339-349 in `saveReport`)
Report capture waits hardcoded 1500 ms / 200 ms for charts to paint; slow machines capture
blank charts. Also guard the empty case.
**Fix:** Before capture, poll every 100 ms (max 5 s) until every chart canvas reports a
nonzero `width`/`height` and Chart.js instances exist (`Chart.getChart(canvas)`), then
proceed. At the top of `saveReport`, bail out with a status message if
`filteredStats.length === 0`. Also null-check `computeScores()` output before attaching to
`reportData` (`src/renderer/utils/reportBuilder.js:111-150`).

### REND-10 (P2, S) — Theme via React context instead of prop drilling
**Status:** Done 2026-06-10. `ThemeContext.js` added and provided at the App root.
**Files:** `src/renderer/App.jsx`, all chart components
`theme` is hand-threaded through every chart and modal.
**Fix:** Create `ThemeContext` in a new `src/renderer/ThemeContext.js`, provide it at the
App root, and replace `theme` props with `useContext(ThemeContext)` in leaf components.
Mechanical; do after REND-1/2 so memoization assumptions stay simple.

### REND-11 (P2, M) — Baseline accessibility for charts and modals
**Status:** Done 2026-06-10. Chart canvases carry `role="img"` + descriptive `aria-label`; ProfileSelector inputs paired with `htmlFor`/`id`; modal focus handling added.
**Files:** chart components, `src/renderer/App.jsx:1054-1106` (About modal),
`src/renderer/components/ProfileSelector.jsx:68-77`
Canvas charts have no aria-labels; the modal lacks a focus trap and initial focus; profile
form inputs lack `htmlFor`/`id` pairing; expandable chart cards are click-only.
**Fix:** (1) Add `role="img"` + descriptive `aria-label` (metric name, date range, latest
value) to each chart canvas. (2) On modal open, focus the close button and restore focus on
close; keep Escape handling. (3) Pair labels/inputs with `htmlFor`/`id`. (4) Give expandable
chart cards `role="button" tabIndex={0}` and Enter/Space key handling.

### REND-12 (P2, S) — Register the installed compression plugin in Vite
**Status:** Done 2026-06-10. Chose the recommended path — `vite-plugin-compression` removed from package.json.
**Files:** `vite.config.mjs`, `package.json`
`vite-plugin-compression` is a dependency but never added to `plugins`. For an Electron app
served from disk, gzip artifacts are useless — decide deliberately.
**Fix:** Either add `compression()` to the plugin list (only if something serves these files
over HTTP) or — recommended — remove `vite-plugin-compression` from package.json. Don't
leave it half-wired.

---

## 5. Testing & repo hygiene

### TEST-1 (P1, M) — Cover the statistical edge cases called out above
**Status:** Done 2026-06-10. Added/extended `correlations.test.js`, `regression.test.js`, `scores.test.js`, `edf-parser.test.js`, `zip-reader.test.js` covering the called-out edge cases.
**Files:** `electron/main/analytics/*.test.js` (extend existing patterns)
Currently untested: Pearson n<3 / zero variance, regression R², outlier detection with
short history, periodic-breathing gap merging, compliance risk with zero-usage nights, EDF
digital→physical scaling with zero gain / inverted ranges.
**Fix:** One test file per analytics module mirroring the existing `scores.test.js` style.
Write these tests *before* implementing DATA-2/3/5/6/7 where practical — they pin current
behavior and prove the fixes.

### TEST-2 (P1, M) — First renderer tests for the pure logic
**Status:** Done 2026-06-10. Added `src/renderer/utils/reportBuilder.test.js` (incl. SEC-7 escaping) and `therapyMetrics.test.js`.
**Files:** new `src/renderer/utils/*.test.js`
The renderer has zero tests. Start with the pure functions: `reportBuilder.js`
(`computeScores` null/empty paths, escaping per SEC-7) and `utils/therapyMetrics.js`
(agreement with the main-process implementation — becomes trivial after DATA-12).
**Fix:** Add the test files using the repo's existing test runner config (check
`package.json` "test" script — the main-process tests already run under it); no DOM/component
testing needed for this task.

### HYG-1 (P2, S) — Decide the fate of `sim_compile.js` and `tsconfig.json`
**Status:** Done 2026-06-10. `sim_compile.js` moved into `scripts/`; `tsconfig.json` kept.
**Files:** `/sim_compile.js`, `/tsconfig.json`
`sim_compile.js` is an unreferenced root-level script (Handlebars template smoke-check);
`tsconfig.json` exists in a JS-only project with `noEmit` (IDE-only).
**Fix:** Move `sim_compile.js` into `scripts/` with a one-line README note *or* delete it
if the report-template test from SEC-7/TEST-2 supersedes it. For `tsconfig.json`: keep it
but add `"checkJs": true` incrementally OR delete it — pick one and note the decision in
README's dev section.

### HYG-2 (P2, S) — Strengthen pre-commit and CI checks
**Status:** Done 2026-06-10. `check` script (`lint && test`) runs in the release workflow on all three OS jobs.
**Files:** `.husky/pre-commit`, `.github/workflows/release.yml`, `package.json`
Pre-commit only runs `lint-staged`; the release workflow doesn't run tests or audit.
**Fix:** Add a `"check": "eslint . && vitest run"`-style script (match the repo's actual
test runner) and run it in the release workflow before the build steps on all three OS
jobs. Keep pre-commit fast (lint-staged only is fine) — CI is the backstop. Also remove
`GH_TOKEN` from build steps that don't publish, per least privilege.

### HYG-3 (P2, S) — Add React lint rules
**Status:** Done 2026-06-10. `eslint-plugin-react` added with `no-unstable-nested-components` + `display-name` as warnings.
**File:** `eslint.config.mjs:23-45`
Only `react-hooks` rules are active; common anti-patterns (unstable nested components,
missing display names) go unflagged.
**Fix:** Add `eslint-plugin-react`, enable `react/no-unstable-nested-components: "warn"`
and `react/display-name: "warn"` (skip `react/prop-types` unless adopting PropTypes). Fix
any new warnings it surfaces or downgrade case-by-case with a comment.

---

## Suggested assignment order

| Wave | Tasks | Theme |
|------|-------|-------|
| 1 | SEC-1, SEC-2, DATA-1, DATA-2, DATA-3, PERF-3 | Small, high-impact, low-risk correctness/safety |
| 2 | PERF-1, PERF-2, PERF-4, DATA-6, DATA-7 | Import-pipeline stability and analytic correctness |
| 3 | REND-1+2, REND-3, REND-4, REND-5, SEC-3, SEC-4, SEC-5 | UI responsiveness + remaining hardening |
| 4 | DATA-4, DATA-5, PERF-5, PERF-6, PERF-7, TEST-1 | Statistical rigor + DB/algorithm efficiency |
| 5 | Everything P2 remaining | Polish, a11y, hygiene, dedup |

Notes for whoever assigns these:
- Each task is independent unless its text says otherwise (REND-1↔REND-2, DATA-12↔REND-8,
  PERF-9 after PERF-1/4).
- Tasks marked "verify outputs identical" are refactors: the assignee must demonstrate
  before/after equivalence, not just green tests.
- One verified non-issue, so nobody re-reports it: the `.reverse()` in
  `computeComplianceRisk` (scores.js:109) is **correct** — `get14DaysUsage` returns
  newest-first and the reverse restores chronological order before the slope.
