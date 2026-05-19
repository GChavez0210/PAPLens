# Changelog

All notable changes to this project are documented in this file.

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
