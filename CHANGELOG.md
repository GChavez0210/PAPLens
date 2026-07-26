# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [2.2.0] - 2026-07-26

### Added

- **Periodic Breathing Trend Chart:** The Overview dashboard gains a per-night periodic-breathing bar chart, with each bar tinted by its severity tier and a dashed 5% clinical-significance rule across the range. Nights where PB was never measured render as gaps rather than 0% bars, so a device that doesn't report PB can't be mistaken for one reporting none.
- **Periodic Breathing on Last Night Detail:** The last-night card now reports the night's PB percentage as a peer of the score lines, plotted against the same 0–20% scale with a marker at the 5% threshold. It is explicitly observational — PB carries no score penalty — and says so on hover.
- **Mask Fit Scoring:** Revived the mask-fit finding, which could never fire because the analytics orchestrator wrote `mask_fit_score` as a hardcoded `null`. Scores now derive from peak leak (p95), median leak (p50) weighted separately so a persistently leaky baseline scores worse than one brief excursion, and per-hour seal breaks — all anchored to the existing shared leak tiers.
- **Profile Data Migration:** Added a one-time, `user_version`-gated backfill that corrects values already written to a profile database, so existing nights pick up fixes without re-importing from the SD card.

### Changed

- **Findings Are Now Range-Level:** The Insights findings panel showed one card per night, each replaying a single night's stored prose beneath a "Last N Days" heading. Findings are now grouped to one card per type, and the body is composed live from the range's trend rows — how often the finding occurred, the typical value, and the worst night, named and dated. Because the text is generated rather than stored, cards can no longer show wording from an older analytics build.
- **Periodic Breathing Severity Colours:** The Insights PB card is tiered on its range-average PB%: green below the 5% threshold, amber from 5–20%, red above 20%, with neutral grey when nothing was detected. The per-night clinical flag keeps its own amber so a green card can still carry a "n nights crossed 5%" note without the two contradicting. The "Detected" badge is amber even on a green card, since presence and severity are different statements.
- **Clinical Thresholds Consolidated:** Moved the stability, mask-fit, flow-limitation, and RIN thresholds into `src/shared/clinicalThresholds.js` alongside the existing leak and AHI values, so the main-process narrative generator and the renderer's range summariser read the same numbers instead of mirroring literals.

### Fixed

- **Expanded Charts Fleeing the Cursor:** Hovering a full-screen chart moved it out from under the pointer. A later `transform: none` hover rule overrode the modal's centring transform at equal specificity, snapping the card half its own size down and right, then back on mouse-leave. Both hover rules are now scoped to exclude the expanded state.
- **"Optimal" Shown on Nights That Lost Points:** Score penalties were rounded to whole points for display while the stability score itself was computed from the unrounded values, so a sub-point deduction reported as `0` and rendered as "Optimal". Penalties now carry one decimal, matching the score they produced.
- **Periodic Breathing Significance Off-By-Rounding:** `pb_is_significant` was tested against the unrounded PB percentage but stored next to the rounded one, so a 4.96% night persisted as "5.0%, not clinically significant" and coloured as if below threshold. The detector now rounds before deciding.
- **Dependency Audit:** Applied `npm audit fix` for a new advisory wave across transitive build tooling (`app-builder-lib`, `builder-util-runtime`, `axios`, `postcss`, `shell-quote`, `tar`), clearing 11 of 12 advisories without downgrades.

### Known Issues

- **Audit Scope Temporarily Narrowed:** `npm run audit` is scoped to production dependencies (`--omit=dev`) for this release, re-narrowing the strict full-tree check that v2.1.0 restored. A new advisory against `brace-expansion` (`<=5.0.7`, GHSA-3jxr-9vmj-r5cp / GHSA-mh99-v99m-4gvg) is patched only in 5.0.8, and the 1.x and 2.x lines have no backported fix — so every `minimatch` 3/5/9 consumer in the build toolchain is flagged with no clean upgrade. Forcing 5.0.8 tree-wide breaks `@electron/asar` (its CommonJS entry is no longer callable), and npm's auto-fix downgrades `electron-builder` 26 → 25/22 rather than moving to genuinely patched versions. None of the affected packages ship in the installer: the five production dependencies (`better-sqlite3`, `chart.js`, `handlebars`, `react`, `react-dom`) audit clean. Restore the full-tree check once `minimatch` picks up `brace-expansion` 5.0.8.

## [2.1.0] - 2026-07-19

### Added

- **Score Tooltips:** LastNight score lines now carry human-readable hover explanations, with an accessible info bubble (hover/focus, `data-tip`, `aria-label`) on each `ScoreBar`.
- **Flow Chart Resampling:** High-resolution flow signals in the session waveform viewer are re-sampled to the current zoom window instead of reverting to a decimated view, with slightly smoothed rendering for clearer zoomed waveforms.

### Changed

- **Rebrand — App Icons & Logo:** Replaced the legacy logo with new PAPLens brand assets (light/dark PNG plus `.ico`/`.icns`) used for the app/window icon on Windows and macOS, and updated every in-app logo reference (boot splash, top nav, profile header, about modal, print/report views).
- **Clinical UI Refresh:** Reworked the visual system to a cleaner clinical style across light/dark themes — updated design tokens, radii, spacing, and typography. Added labeled sidebar navigation, moved data status into the sidebar, and introduced section eyebrow/page heading patterns for Overview, Sessions, and Insights. Profile selection/creation screens now share a branded header component, and chart/report color palettes and the Electron window background were aligned with the refreshed theme.
- **Build Tooling — Vite 8:** Upgraded `vite` 7 → 8 (rolldown/oxc bundler) and `@vitejs/plugin-react` 5 → 6, switching the production `minify` setting to `oxc`. Also bumped `wait-on` and added an explicit, current `esbuild` devDependency, and declared an `engines.node` range (`^20.19.0 || >=22.12.0`) matching Vite 8's runtime requirement so installs fail fast on unsupported Node. This clears the dev-server `esbuild` advisories and the `wait-on`→`joi` advisory at the source, so `npm run audit` is restored to the strict full-tree check (`npm audit --audit-level=high`), reverting the temporary `--omit=dev` scope introduced for the v2.0.0 release.
- **Dependency Audit:** Applied `npm audit fix` for newly-disclosed advisories in transitive dev-tooling packages (`form-data`, `@babel/core`, `js-yaml`, `tar`), restoring a clean `npm run audit` gate.
- **Release CI — Windows Runner:** Pinned the Windows release job to `windows-2022` instead of `windows-latest`: the `windows-latest` label now resolves to an image whose preinstalled Visual Studio version `node-gyp` can't detect, breaking the `better-sqlite3` native rebuild during packaging.

## [2.0.0] - 2026-06-13

### Added

- **Visual Overhaul:** Refreshed the entire application UI across the dashboard, import flow, charts, and metadata panels for a cleaner, more consistent look in both light and dark themes.
- **Daily Session Graph Tooltips:** Event markers on the Pressure chart are now clickable and carry plain-English explanations — hovering shows the event type plus a one-line description, and clicking pins a detail popover describing what the event means and what to do about it. Periodic-breathing episodes gain clickable badges on the Breathing Amplitude chart that explain the episode and its duration. Annotations that aren't describable respiratory events (e.g. recording-start markers) are no longer plotted, and zero-duration ResMed point flags are labelled accordingly instead of showing a misleading "0s" duration.
- **Renderer Resilience:** Added an Error Boundary around dashboard, session, insights, and modal regions so a render-time chart or page failure no longer blanks the entire app shell.
- **Insights Lazy Loading:** The Insights page is now loaded as a separate renderer chunk, reducing the initial dashboard bundle size.
- **Development Checks:** Added `npm test`, `npm run check`, and `npm run audit` scripts. Node tests are discovered through `scripts/run-node-tests.js` for reliable cross-platform execution.
- **Release CI Gates:** Release builds now run lint/tests and high-severity audit checks before packaging on Windows, macOS, and Linux.
- **Repo Scripts:** Moved the report-template Handlebars smoke check into `scripts/sim_compile.js` and documented the scripts folder.
- **Renderer Utility Tests:** Added renderer pure-logic coverage for report score handling, report-template escaping, and therapy metric formatting/percentiles. Renderer utility tests are bundled through the existing Node test runner.
- **Import Payload Measurement:** Added `cpap:data-loaded` payload measurement that logs byte size, MiB, daily-stat count, and session count, with a warning when representative payloads exceed roughly 1 MiB.
- **Analytics test suite expanded:** Added `regression.test.js` (Pearson edge cases), `outliers.test.js` (short-history guard), `periodicBreathing.test.js` (gap-merge boundary conditions via `mergeEpisodes`), and `clinicalInsights.test.js` (leak basis thresholds and corrupted-percentile clamp). Extended `scores.test.js` with compliance-risk zero-usage and pressure-spread cases.
- **Correlation Significance Tests:** Added coverage for correlation p-values and significance metadata.
- **Spearman Correlations:** Correlation payloads now include Spearman `rho`, retained Pearson `pearsonR`, and a `method` marker, with Spearman reported as the headline value for skew-sensitive therapy metric pairs.
- **Sleep Boundary Timezone:** The sleep-boundary control accepts an optional IANA timezone so ResMed night assignment is explicit around noon and DST boundaries.
- **Session Waveform Viewer — Event Overlay:** Flagged respiratory events (hypopnea, obstructive apnea, central apnea, RERA, leak) are now rendered as colour-coded scatter markers directly on the Pressure chart, pinned to the actual mask pressure value at each event's onset time. Tooltip shows event type and duration. The separate Flagged Events chart has been removed.
- **Session Waveform Viewer — Layout:** Breathing Amplitude chart now spans the full grid width, matching Pressure and Flow Rate.
- **PDF Report:** Expanded from two pages to three pages. Page 3 contains the flow limitation trend chart and the clinician interpretation panel (previously on page 2).

### Changed

- **Dependency Audit:** Checked Electron, `better-sqlite3`, and `handlebars` currency. Electron remains on the packageable `39.8.10` line after the current `42.4.0` line failed the `better-sqlite3` native rebuild during packaging.
- **Chart Rendering Efficiency:** Wrapped chart components in `React.memo`, stabilized dashboard chart datasets with `useMemo`, and updated `TrendChart` so Chart.js instances update in place instead of being destroyed and recreated on every parent render.
- **Dashboard Range Filtering:** Dashboard stats are now sorted once per range calculation, then sliced or filtered from that sorted array.
- **Insights Efficiency:** Memoized derived Insights arrays and display booleans, hoisted the nested stat card component, and guarded asynchronous Insights IPC responses so stale range loads cannot overwrite newer data.
- **Import Responsiveness:** ResMed and third-party vendor import paths now use async file I/O inside `loadAll`, reducing main-process blocking during large SD-card imports. Static loader detection remains synchronous for compatibility with the current registry API.
- **Nightly Metric Memory Use:** ResMed EDF-derived nightly metrics are summarized one night at a time, so raw waveform arrays are released after each night instead of accumulating across an entire card.
- **Session Detail Payloads:** Session waveform detail responses now cap each signal to 2,000 points and include downsampling metadata while preserving sample-count information.
- **Analytics Query Efficiency:** Nightly analytics now fetch an ordered range once and derive trailing history/usage/AHI windows in memory instead of issuing repeated per-night query batches.
- **Percentile Calculation:** Nightly metric summarization now sorts each metric once and computes all needed percentiles from the sorted samples.
- **STR.edf Refreshes:** STR summary parsing now runs asynchronously and reuses a profile-local cache when file size and modified time are unchanged.
- **EDF Parser Worker Offload:** Async EDF parsing now runs file read and parse work in a worker thread, reducing main-process CPU blocking during ResMed imports.
- **Nightly Sample Counts:** Per-night valid sample counts are persisted in `night_metrics.sample_counts`, reused by cached imports, and hydrated back into summary objects.
- **Lint Coverage:** Enabled selected React lint rules for display names and unstable nested components while keeping the existing React Hooks rules active.
- **Dependency Hygiene:** Updated `concurrently` to clear the critical `shell-quote` audit advisory.
- **Release Workflow Hygiene:** Removed unnecessary `GH_TOKEN` exposure from build jobs that only package artifacts.
- **Release Audit Scope:** `npm run audit` now scopes to production dependencies (`--omit=dev`). The shipped Electron app bundles no build tooling, so dev-only advisories in `vite`/`esbuild` (dev server) and `wait-on`→`joi` no longer block packaging. A full-tree `npm audit` still surfaces them, and a `vite` 8 upgrade is tracked as follow-up.

### Fixed

- **CSP Hardening:** Added Content Security Policy meta tags to the app and report HTML entry points, removed the report's inline footer script, and dropped the remote Google Fonts import so the renderer stays local/offline-friendly.
- **Security Hardening Wave 1:** Added defensive validation for SQLite migration identifiers, IPC-loaded data-folder paths, ZIP archive expansion limits, and EDF header bounds.
- **Parser Safety Tests:** Added ZIP and EDF parser coverage for oversized declared output, entry-count and cumulative ZIP limits, impossible EDF signal counts, oversized samples, and truncated declared record data.
- **Report Profile Escaping:** Report profile fields are now string-coerced before templating, with escaped Handlebars bindings retained for user-entered values.

- **DATA-1 — Stability score history argument:** `computeTherapyStabilityScore` now accepts historical metrics and applies a bounded baseline penalty when at least seven prior therapy nights are available, so the previously ignored history argument now affects scoring.

- **DATA-2 — Compliance risk ignored skipped nights:** `computeComplianceRisk` was filtering out zero-usage nights before computing the 7/14-day window, so a patient using the device 2 of 14 nights could appear low-risk. Zero-usage nights are now kept as `0` (the array is filtered only when entirely empty).

- **DATA-3 — Spurious correlations at n < 3:** `pearsonR` returned ±1 for n = 2 (always mathematically true, clinically meaningless) and did not guard against zero-variance inputs. It now returns `null` for n < 3 or zero-variance cases. `correlations.js` skips any result where `r` is `null`, and the minimum-pairs threshold was raised from 2 to 3.

- **DATA-4 — Correlation noise context:** Correlation results now include sample count, p-value, and significance metadata so the Insights UI can distinguish statistically significant relationships from noise.

- **DATA-5 — Trend fit metadata:** `regressionSlope` now returns slope, intercept, R², standard error, and sample count, with a compatibility wrapper for existing numeric slope callers.

- **DATA-6 — False outlier flags on first nights:** `detectOutliers` produced inflated z-scores on early nights because `std()` returned 0 for short history and division by a near-zero epsilon clamp was used as a workaround. The function now returns empty results when valid history contains fewer than 3 nights. `zScore()` in `rolling.js` returns `null` instead of clamping, and callers skip null z-scores.

- **DATA-7 — Periodic-breathing episode boundary off-by-one:** The episode merge loop tracked a `gapRun` counter and computed `epEnd = i - gapRun`, placing the boundary inside the trailing gap. This inflated episode duration and allowed sub-threshold runs to pass the minimum-length check. The merge logic now tracks `lastFlagged` so boundaries always land on the last flagged sample. The merge logic was extracted into a standalone `mergeEpisodes()` function.

- **DATA-8 — Misleading `pressureSd` variable name:** Renamed `pressureSd` → `pressureSpread` in `computeTherapyStabilityScore` to accurately reflect that the metric is a p95 − median percentile spread (≈ 1.35σ), not a standard deviation. Added a clarifying comment noting that penalty thresholds are calibrated for spread scale, not σ.

- **DATA-9 — Leak severity under-flagged when only median is available:** `classifyLeakSeverity` always applied p95-calibrated thresholds (> 24 / > 12 / > 5 L/min) even when the orchestrator's fallback chain had substituted `leak_p50`, under-flagging severity by roughly 2×. The function now accepts a `{ basis }` option; `basis: "p50"` applies halved thresholds (> 12 / > 6 / > 2.5 L/min). The orchestrator detects which field it is passing and sets the basis. Corrupted percentile order (p95 < p50) is also clamped.

- **Last-Night Score Details:** The IPC route that fetches last-night details now passes the retrieved 30-night history into `computeTherapyStabilityScore`, matching the intended scoring call shape.
- **SQLite Hydration Index:** Added a covering index for the night-metrics join used during startup hydration.
- **Session Graphs Cleanup:** Removed the unused `EventsChart` helper after event markers moved onto the Pressure chart.
- **Audit Gate:** `npm run audit` now passes with zero reported vulnerabilities.

## [1.5.0] - 2026-05-19

### Added

- **Periodic Breathing Detection:** New `periodicBreathing.js` analytics module detects Cheyne-Stokes / periodic breathing patterns from the 2-second tidal volume signal. Implements the AASM clinical algorithm: centred moving-average smoothing → sliding-window oscillation depth → episode merging with gap tolerance → cycle-count validation (≥3 crescendo-decrescendo cycles in the 30–120 s range). Results stored as `pb_episode_count`, `pb_total_seconds`, `pb_pct`, `pb_avg_cycle_sec`, and `pb_is_significant` in `night_metrics`.
- **Periodic Breathing Card:** New `PeriodicBreathingCard` component on the Insights page displays average PB%, episode count, total PB time, average cycle length, and a colour-coded significance flag (≥5% = clinically significant per AASM). Hover tooltip explains Cheyne-Stokes respiration and management options.
- **Session Waveform Viewer:** New `SessionGraphsModal` component renders per-session EDF signals as interactive Chart.js charts — Flow Rate (BRP), Breathing Amplitude envelope, Flagged Events (scatter), Flow Limitation index, Leak Rate with 24 L/min threshold, and Mask/EPAP Pressure. Periodic breathing episodes are overlaid as amber highlight regions on the amplitude chart. Supports multi-session days via a session picker.
- **Flow Limitation & RIN Chart:** `FlowLimitationChart` is now a dual-axis line chart combining `flow_limitation_p95` (left axis, 0–1) and `rin_per_hr` (right axis, events/hr), with dashed threshold lines at 0.10 (mild) and 0.30 (significant).
- **Flow Limitation Insight Narratives:** `generateFlowLimitationInsight()` produces contextual clinical summaries when FL P95 exceeds thresholds or RIN is elevated, including trend information across recent nights.
- **Periodic Breathing Insight Narratives:** `generatePeriodicBreathingInsight()` produces plain-English summaries when PB is detected, distinguishing sub-threshold (≥2%) from clinically significant (≥5%) findings.
- **Additional Per-Night Metrics:** `snore_index` (% of epochs above noise threshold), `leak_spike_count` (epochs >24 L/min), `pressure_histogram` (10-bin distribution from PLD signal), and `pressure_efficiency` (% time near pressure ceiling) are now computed from PLD waveform data and stored in `night_metrics`.
- **30-Day CMS Compliance Panel:** Insights page now shows a rolling compliance rate (% of nights ≥4 hrs) with a visual bar, compliant night count, and a CMS 70% threshold indicator.
- **Weekend vs Weekday Comparison:** Insights page compares average AHI and usage between weekend and weekday nights with a delta indicator.
- **Light/Dark Theme Toggle:** Full light-mode theme with CSS variable overrides, logo switching (PLLogoL / PLLogoD), and persistent preference via `localStorage`.
- **Hover Tooltips on Insight Cards:** Each insight type (stability, mask fit, compliance, outlier, periodic breathing, flow limitation) now has a hover tooltip explaining the clinical meaning and recommended action.
- **Insight Deduplication and Range Adaptation:** Explanations are deduplicated by key across the selected range, and single-night titles are automatically reworded for multi-night contexts.

### Changed

- `AnalyticsOrchestrator` now runs `generatePeriodicBreathingInsight` and `generateFlowLimitationInsight` as part of the nightly insight pipeline.
- Correlations table is now replaced (not appended) on each analytics run, preventing unbounded table growth.
- `getSleepNightKey` date-clone fix: both branches of the ternary were previously identical; corrected to properly clone Date objects vs. parse strings.
- `Math.max(...largeArray)` replaced with `reduce` loops in `sessionMetrics.js` to avoid potential call-stack overflow on long recordings.
- `FlowLimitationChart` wraps the `nights` filter in `useMemo` to prevent unnecessary Chart.js instance destruction on unrelated parent re-renders.
- Threshold line in `SessionGraphsModal` leak chart uses a 2-point span instead of allocating a full copy of the signal array.
- Removed the `ICONS` identity-map object from `Insights.jsx`; icon type is now derived directly from `insight.key`.
- Phase 10 DB columns (`rin_per_hr`, `csr_per_hr`, `snore_index`, `leak_spike_count`, `pressure_histogram`, `pressure_efficiency`, `pb_*`) added via safe `addColumnIfNotExists` migrations in `ProfileDatabase.init()`.

### Fixed

- Correlations row was inserted on every import but never cleaned up; a `DELETE` before re-insert now keeps the table at one row per device/window.
- `getSleepNightKey` now correctly clones Date objects by passing `.getTime()` to the `Date` constructor.

## [1.4.0] - 2026-05-13

### Added

- **Cross-platform build support:** macOS (DMG, Intel x64 + Apple Silicon arm64) and Linux (AppImage, x64 + arm64) build targets added via `electron-builder`.
- New npm scripts: `dist:mac`, `dist:linux`, `dist:win`, `dist:win:x64`, `dist:win:arm64`, `dist:win:portable`.
- Platform-specific icons: `.icns` for macOS, `.png` for Linux.
- `macOS` category set to `public.app-category.healthcare`; Linux category set to `Science`.
- Expanded `README.md` with build instructions for all three platforms, runtime requirements, and troubleshooting table.

## [1.3.0] - 2026-05-13

### Added

- **Metrics:** RIN (respiratory irregularity) and snore index tracking per night, surfaced in reports and the database.
- **Analytics:** Correlation analysis between key therapy metrics (AHI, leak, pressure, tidal volume), stored per device and surfaced in the Insights view.
- **Analytics:** Therapy stability score tier labels and visual badges for at-a-glance session quality.
- **Report:** Tooltip overlays on report section headers for contextual metric explanations.
- **Report:** Pressure histogram data captured from PLD waveform files and included in exported reports.
- **Report:** Configurable export filename with datestamp and time suffix.

### Changed

- Polished report UI layout and export flow (dialog and progress feedback).
- Pressure chart uses P95 delivered mask pressure as primary source, falling back to configured max.
- DB queries tuned for insights and last-night overview endpoints.

## [1.0.0] - 2026-03-05

### Added

- Desktop PAP/CPAP analytics application for ResMed AirSense data with local/offline processing.
- Incremental ResMed SD-card import into a local SQLite profile database.
- Multi-profile support with isolated user data.
- Device metadata detection from identification files.
- Dashboard, clinical daily session views, and analytics/insights workflows.
- Print-ready PDF report generation using Handlebars templates rendered through Electron `printToPDF`.
- Windows installer outputs for both `x64` and `arm64` architectures.
- **PDF Report:** Added therapy mode (CPAP/APAP), min/max pressure settings, and EPR information to device details.
- **PDF Report:** Added average CAI, OAI, and HI metrics alongside the existing Average AHI.
- **PDF Report:** Added the 95th percentile leak value, including references to the threshold used.
- **PDF Report:** Added statistical metadata (number of nights analyzed) for clarity.
- **PDF Report:** Added adherence metrics, including ≥ 4h adherence rate, nights < 4h, and longest usage gap.

### Changed

- Added this `CHANGELOG.md` to track project updates.
- Added a changelog reference in `README.md`.
- **PDF Report:** Improved Mask Fit Score calculation to indicate "Insufficient data" rather than defaulting to 0 when data is incomplete.
- **PDF Report:** Improved plain-english correlation texts for clearer interpretation of residual burden indicators.
- **PDF Report:** Shifted report compilation logic to the frontend to ensure deterministic PDF generation.

### Analytics

- AHI trends and event-type breakdown.
- Usage/adherence tracking, including 4-hour adherence rate context.
- Leak analysis with percentile context.
- Pressure, ventilation/flow, and tidal trend summaries.
- Residual burden indicators and correlation interpretation.
- Stability and mask-fit scoring when source inputs are available.
