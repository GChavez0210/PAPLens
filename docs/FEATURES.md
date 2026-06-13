# PAPLens Feature Reference

PAPLens is a fully offline desktop analytics tool for PAP therapy data. It reads supported SD-card exports, runs the analytics pipeline locally, and produces dashboard views plus printable reports designed to support conversations with a care team.

## Core Capabilities

- Imports supported SD-card data incrementally into a local SQLite profile database. Only new or changed nights are re-processed on later imports.
- Supports multiple isolated patient profiles, each with its own database, session EDF cache, and last-used data path.
- Detects device model and metadata from supported device files.
- Runs scoring, outlier detection, correlation analysis, periodic breathing detection, and insight narrative generation locally.
- Provides trend charts, a sleep calendar heatmap, and a last-night summary sidebar.
- Provides an Insights page with metric trends, CMS compliance tracking, Pearson correlation analysis, periodic breathing analysis, and flow limitation tracking.
- Opens per-session waveform viewers for high-resolution EDF signals, including flow, pressure, leak, SpO2, and detected event overlays when supported by the device.
- Generates print-ready three-page PDF reports for patient-to-clinician review.

## Metrics Tracked Per Night

| Metric | Description |
|--------|-------------|
| AHI | Total apnea-hypopnea index, in events/hr |
| CAI / OAI / UAI / HI | Event-type breakdown: central, obstructive, unclassified, hypopnea |
| Leak P50 / P95 | Median and 95th-percentile unintentional leak, in L/min |
| Leak spike count | Number of 2-second epochs where leak exceeded 24 L/min |
| Pressure median / P95 | Delivered pressure distribution, in cmH2O |
| Pressure histogram | 10-bin distribution of delivered pressure across the session |
| Pressure efficiency | Percentage of epochs at or near the session pressure ceiling |
| Minute ventilation P50/P95 | Breathing volume per minute |
| Tidal volume P50/P95 | Volume per breath |
| Respiratory rate P50 | Breaths per minute |
| RIN | Respiratory Disturbance Index: sub-threshold flow-limited events per hour |
| Flow limitation P95 | 95th-percentile flow limitation index from the PLD signal |
| Snore index | Percentage of session epochs with snore amplitude above noise threshold |
| PB episode count | Number of detected periodic breathing episodes per night |
| PB total time | Total seconds of periodic breathing per night |
| PB% | Periodic breathing as a percentage of total recording time |
| PB avg cycle | Estimated crescendo-decrescendo cycle length, in seconds |
| SpO2 / Pulse | Oxygen saturation and heart rate, when available from device |

## Dashboard

- AHI trend chart with selectable time range and 7-night rolling average.
- Usage trend with the 4-hour compliance threshold marked.
- Pressure and leak chart plotting median pressure and P95 leak together.
- Ventilation and flow chart for minute ventilation and flow limitation trends.
- Tidal volume trend chart.
- Sleep calendar heatmap across all imported nights.
- Last-night sidebar with the most recent session summary and sparklines for key metrics.
- Session waveform viewer from any day with high-resolution EDF data, including flow rate, breathing amplitude, flagged events, flow limitation, leak, pressure, and periodic breathing overlays.
- Preset time ranges for 7, 14, 30, 90, 180 days, all time, plus custom date range.
- Adjustable sleep boundary hour for shift workers or non-standard schedules.
- Dark and light theme support.

## Clinical Analytics Engine

All analytics run locally at import time. No therapy data leaves the machine.

| Feature | Detail |
|---------|--------|
| Therapy Stability Score | 0-100 score measuring night-to-night consistency across AHI, leak, and pressure. Tiers: Optimal, Stable, Acceptable, Suboptimal, High Risk |
| Leak severity classification | Tiered leak assessment with a leak consistency index |
| Compliance risk score | Rolling 14-night usage assessment against the CMS 4-hour threshold |
| Residual burden tracking | 30-night AHI trend analysis flagging sustained elevated burden |
| Outlier detection | Z-score based flagging of nights with statistically abnormal values |
| Periodic breathing detection | AASM-aligned algorithm using tidal-volume smoothing, sliding-window oscillation depth, episode merging, and cycle-count validation |
| Flow limitation analysis | Tracks FL P95 alongside RIN across the selected range, with trend notes when elevated on multiple recent nights |
| Metric correlations | 30-night Pearson r analysis for Leak/AHI, Pressure/AHI, Usage/AHI, Pressure/Leak, and lag-1 Pressure-to-next-night-AHI response |
| Insight narratives | Plain-English explanations for flagged nights, covering stability, compliance, outliers, periodic breathing, and flow limitation |

## Insights Page

- Full per-night metric table across the selected range.
- Average summary for AHI, usage, pressure, leak, ventilation, and tidal volume with explanatory tooltips.
- CMS 30-day compliance panel with compliant night count vs. the 70% threshold.
- Weekend vs. weekday AHI and usage comparison.
- Event type breakdown chart.
- Flow limitation and RIN dual-axis trend chart with mild and significant threshold lines.
- Averaged pressure distribution histogram across nights with high-resolution data.
- Periodic Breathing card with PB%, episode count, total PB time, average cycle length, and clinical significance flag.
- Metric correlations panel with strength labels and plain-English interpretations.
- Clinical insight narratives from the analytics engine.

## PDF Report Export

The Save Data Report action generates a print-ready Letter-format PDF.

### Page 1: Clinical Summary

- Patient and device info strip.
- Key KPIs: average AHI, average usage, and leak P95.
- Respiratory event profile.
- Adherence and 30-day CMS compliance panel.
- Therapy Stability Score.
- Metric Correlations card, when data is available.
- Metric calculation reference.
- Clinician question checklist.

### Page 2: Trend Charts & Interpretation

- Five trend charts rendered as images.

### Page 3: Flow Limitation & Clinician Interpretation

- Flow limitation trend chart with mild and significant threshold lines.
- Clinician interpretation panel with correlation guide and Pearson r values.

## Multi-Profile Support

- Create, switch, and delete profiles for different patients or device configurations.
- Each profile has its own isolated SQLite database, session EDF cache, and last-used data path.
- Active profile is persisted securely between sessions using OS-level credential storage through Electron `safeStorage`.
