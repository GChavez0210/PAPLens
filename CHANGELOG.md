# Changelog

All notable changes to this project are documented in this file.

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
