<div align="center">

![PAPLens Logo](PAPLens-Logo.png)

# PAPLens

[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/GChavez0210/PAPLens)

**Standalone Desktop CPAP Analytics for ResMed AirSense 10/11**

</div>

PAPLens is a standalone, high-performance desktop analytics application for in-depth analysis of ResMed AirSense 10 and AirSense 11 CPAP datasets.

The platform operates entirely on-device with zero cloud dependency, ensuring full data privacy while delivering clinically meaningful metrics derived from high-resolution therapy data.

---

## Platform Capabilities

### Multi-Profile Data Isolation
Each user profile has a fully isolated SQLite database. Therapy datasets remain segregated, enabling independent analytics environments for multiple patients.

### Incremental Differential Import Engine
The import pipeline parses ResMed SD-card folders and performs differential ingestion - only newly detected nights are processed via transactional `UPSERT` logic.

### Device Auto-Detection
Device model (AirSense 10 / AirSense 11) is automatically detected from `productName` in `Identification.tgt` / `Identification.json`. No manual device selection is required.

### Clinical-Grade PDF Reporting
Print-ready reports are generated through Electron's rendering pipeline, including patient ID, device metadata, aggregated analytics, and chart captures.

---

## Analytics Engine & Mathematical Framework

### Treatment Score (0–100)

A deterministically weighted penalty-based composite index. Each night's score starts at **100** and penalties are subtracted:

```
Score = 100 - penaltyAHI - penaltyLeak - penaltyUsage - penaltyPressureVar - penaltyFlowLim
Score = clamp(Score, 0, 100)
```

#### 1. AHI Penalty (max 50 pts)

| AHI Range       | Penalty Formula              |
|----------------|------------------------------|
| AHI ≤ 1        | 0                            |
| 1 < AHI <= 5   | `(AHI - 1) * 5`             |
| 5 < AHI <= 15  | `20 + (AHI - 5) * 3`        |
| AHI > 15       | 50 (max)                     |

#### 2. Leak Penalty (max 25 pts)

Uses the 95th-percentile leak value (`leak_p95`):

| Leak (L/min)        | Penalty Formula                        |
|--------------------|----------------------------------------|
| leak ≤ 10          | 0                                      |
| 10 < leak <= 24     | `(leak - 10) * (15 / 14)`             |
| leak > 24           | `15 + min(10, (leak - 24) * 0.5)`     |

#### 3. Usage Penalty (max 15 pts)

| Usage (hrs)     | Penalty Formula              |
|----------------|------------------------------|
| usage ≥ 7      | 0                            |
| 4 <= usage < 7  | `(7 - usage) * 3`           |
| usage < 4      | `min(15, 9 + (4 - usage) * 3)` |

#### 4. Pressure Variability Penalty (max 5 pts)

Uses `pressureSd = P95 − P50` (or historical σ if P95 unavailable):

| pressureSd      | Penalty Formula              |
|----------------|------------------------------|
| <= 2            | 0                            |
| 2 < sd <= 6    | `(sd - 2) * 1.25`           |
| > 6            | 5 (max)                      |

#### 5. Flow Limitation Penalty (max 5 pts)

Uses `flow_limitation_p95`:

| flp95           | Penalty Formula              |
|----------------|------------------------------|
| <= 0.10         | 0                            |
| 0.10 < flp95 <= 0.30 | `(flp95 - 0.10) * 25` |
| > 0.30         | 5 (max)                      |

---

### Score Classification (5 Tiers)

| Score Range | Tier Label   | Meaning                                |
|-------------|--------------|----------------------------------------|
| 95–100      | **Optimal**  | All clinical parameters within target  |
| 85–94       | **Stable**   | Minor deviations, therapy effective    |
| 70–84       | **Acceptable** | Some suboptimal events, monitor      |
| 50–69       | **Suboptimal** | Multiple penalty contributors active |
| < 50        | **High Risk** | Significant therapy compromise        |

---

### Leak Severity Classification (4-Tier)

Evaluated using 95th-percentile leak and leak duration:

| Tier | Label    | Condition                                              |
|------|----------|--------------------------------------------------------|
| 1    | Stable   | leak <= 10 L/min and duration <= 0%                    |
| 2    | Mild     | leak > 10 OR duration 0-10% of session               |
| 3    | Moderate | leak > 24 OR duration > 10%                          |
| 4    | Severe   | leak > 35 OR duration >= 30 min                       |

**Leak Consistency Index** = `(leak_duration_minutes / usage_minutes) × 100`

---

### Compliance Risk Predictor

Computed from a 14-day linear regression slope on nightly usage hours:

```
slope_14 = regressionSlope(last14UsageHours)
avg_7    = mean(last 7 nights)
avg_prior = mean(previous 7 nights)
pct_change = (avg_7 - avg_prior) / max(avg_prior, epsilon)
```

| Condition                                      | Risk Level |
|-----------------------------------------------|------------|
| avg_7 < 4 OR (avg_14 < 4 AND slope < 0)      | **High**   |
| avg_7 in [4,5) OR pct_change < -15%           | **Medium** |
| Otherwise                                     | **Low**    |

---

### Pearson Correlation Engine

Dynamic Pearson `r` is calculated across:
- Leak ↔ AHI
- Pressure ↔ AHI
- Usage ↔ AHI
- Pressure ↔ Leak

**Interpretation thresholds:**

| \|r\| Range | Strength    | Clinical meaning (Leak <-> AHI example)                        |
|-----------|-------------|--------------------------------------------------------------|
| 0.00-0.19 | Negligible  | No meaningful relationship                                   |
| 0.20-0.39 | Mild        | Higher leak may slightly increase AHI                        |
| 0.40-0.59 | Moderate    | Leak likely impacting event control                          |
| >= 0.60    | Strong      | Leak is a major driver of elevated AHI                      |
| <= -0.20   | Negative    | Inverse - uncommon; may indicate detection artifacts         |

---

### Outlier Detection

Each night is compared to a rolling 30-day baseline:

```
Z-Score = (value − mean) / std
Alert triggered when |Z-Score| > 2.5
```

---

### Residual Burden

Computed from the AHI distribution over the selected time window:

```
nights_over_5  = count(AHI > 5)
nights_over_10 = count(AHI > 10)
AHI_p95        = sorted[floor(n × 0.95)]
```

---

### Averaging Logic

All averages (Dashboard overview and Analytics section) use:

```
avg = sum(v for v in values where v != null && !isNaN(v) && v >= 0) / count
```

Zero values (e.g., AHI = 0.0) are **included** in the average, as they represent genuinely optimal nights.

All averages use the **50th-percentile leak** (`leak_p50`) for consistency across Dashboard and Analytics sections.

---

### 7-Day Rolling AHI Average

Displayed on AHI charts as an overlay:

```
rolling7[i] = mean(AHI[max(0, i−6) .. i])
```

---

## UI Features

### Dynamic Timeframe Selection

Available in both Dashboard and Analytics:
- Last 7 / 14 / 30 / 60 / 90 / 180 / 365 days
- All Time
- Custom date range

All charts, averages, correlations, and burden metrics recalculate on timeframe change.

### Treatment Efficacy Viewer

A dot-per-night strip at the bottom of the Dashboard. Click any dot to reveal a floating detail card with date, score, AHI, Usage, Leak, Pressure. Dots are color-coded by score tier.

### Last Night Overview (Sidebar)

Displays for the most recently recorded night:
- Score with 5-tier label and tier color
- Score breakdown: estimated penalty per component (AHI, Leak, Usage, Pressure Variance, Flow Limitation)
- Key metrics: AHI, Usage, Pressure, Leak P50
- Contextual alert flags (leaked > threshold, AHI > 5, usage < 4h, outlier nights)

### Chart Enhancements

- **AHI chart**: 7-day rolling average overlay (dashed cyan) + AHI = 5 threshold line (dashed red)
- **Leak chart**: 24 L/min critical threshold line (ResMed standard)
- **Pressure chart**: Variability Index (P95 − P50) as a purple dashed overlay

### Metric Correlation Tooltips

Hover over any correlation bar to see a detailed clinical interpretation specific to the metric pair and the computed `r` value range.

---

## Supported Data Structure

PAPLens requires a direct copy of a compatible ResMed SD card:

- `STR.edf` — high-resolution signal and event records
- `DATALOG/` — nightly physiological records
- `Identification.tgt` or `Identification.json` — device metadata (model, serial, firmware)

---

## Technology Stack

| Layer         | Technology              |
|--------------|-------------------------|
| Desktop runtime | Electron              |
| UI           | React + Vite            |
| Visualization | Chart.js 4.x           |
| Storage      | SQLite (better-sqlite3) |
| Analytics    | Node.js                 |

---

## Local Development

```bash
git clone https://github.com/your-repo/PAPLens.git
cd PAPLens
npm install
npm run dev
```

Development mode launches Vite with hot module reloading.

---

## Production Build

```bash
npm run dist
```

Output goes to `/release/` as `PAPLens Setup [version].exe`.

---

## Compliance Notice

PAPLens is an analytical support tool. It does not provide medical diagnosis, prescribe treatment, or replace professional clinical evaluation. Consult a qualified healthcare provider for medical interpretation of therapy data.

---

## License

MIT License — see [LICENSE](LICENSE) for details.