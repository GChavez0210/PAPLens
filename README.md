# PAPLens (v1.4.0)

<p align="center">
  <img src="PAPLens-logo.png" alt="PAPLens Logo" width="250">
</p>

Desktop PAP/CPAP analytics for ResMed AirSense data, running fully offline.

Repository: https://github.com/GChavez0210/PAPLens

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the latest updates and release history.

## What PAPLens does

PAPLens is a fully offline desktop analytics tool for ResMed PAP therapy data. It reads your SD card, runs a clinical analytics pipeline locally, and gives you a dashboard and printable report designed to support conversations with your care team.

- Imports ResMed SD-card data (EDF format) incrementally into a local SQLite profile database — only new or changed nights are re-processed on subsequent imports.
- Supports multiple isolated patient profiles, each with their own database and last-used data path.
- Detects device model and metadata (AirSense 10 / AirSense 11) from identification files.
- Runs a full analytics pipeline on import: scoring, outlier detection, correlation analysis, and insight narrative generation — all local, no cloud.
- Provides a dashboard with trend charts, a sleep calendar heatmap, and a last-night summary sidebar.
- Provides an Insights page with metric trends, CMS compliance tracking, and Pearson correlation analysis.
- Generates print-ready two-page PDF reports intended for patient-to-clinician review.
- Exports platform-native installers: **Windows** (NSIS `.exe`), **macOS** (DMG), and **Linux** (AppImage) — each supporting `x64` and `arm64`.

## Screenshots

![Screenshot 1](SCREENSHOTS/PL1.png)
![Screenshot 2](SCREENSHOTS/PL2.png)
![Screenshot 3](SCREENSHOTS/PL3.png)
![Screenshot 4](SCREENSHOTS/PL4.png)
![Screenshot 5](SCREENSHOTS/PL5.png)
![Screenshot 6](SCREENSHOTS/PL6.png)
![Screenshot 7](SCREENSHOTS/PL7.png)

## Metrics tracked per night

| Metric | Description |
|--------|-------------|
| AHI | Total apnea-hypopnea index (events/hr) |
| CAI / OAI / UAI / HI | Event-type breakdown — central, obstructive, unclassified, hypopnea |
| Leak P50 / P95 | Median and 95th-percentile unintentional leak (L/min) |
| Pressure median / P95 | Delivered pressure distribution (cmH₂O) |
| Minute ventilation P50/P95 | Breathing volume per minute |
| Tidal volume P50/P95 | Volume per breath |
| Respiratory rate P50 | Breaths per minute |
| RIN | Respiratory Disturbance Index — sub-threshold flow-limited events per hour |
| Snore index | % of session epochs with snore amplitude above threshold |
| Pressure efficiency | % of epochs at or near the pressure ceiling |
| SpO₂ / Pulse | Oxygen saturation and heart rate when available from device |

## Dashboard

- **AHI trend chart** — nightly AHI over any selected time range
- **Usage trend** — hours per night with the 4-hour compliance threshold marked
- **Pressure & leak chart** — median pressure and P95 leak plotted together
- **Ventilation & flow chart** — minute ventilation and flow limitation trends
- **Tidal volume chart** — nightly tidal volume P50
- **Sleep calendar heatmap** — colour-coded calendar across all imported nights
- **Last night sidebar** — most recent session summary with sparklines for key metrics
- **Time range filter** — presets (7 / 14 / 30 / 90 / 180 days / all time) plus a custom date range picker
- **Sleep boundary hour** — adjustable start-of-day hour for shift workers or non-standard schedules
- **Dark / light theme** toggle

## Clinical analytics engine

All analytics run locally at import time. No data leaves the machine.

| Feature | Detail |
|---------|--------|
| **Therapy Stability Score** | 0–100 score measuring night-to-night consistency across AHI, leak, and pressure. Tiered: Optimal / Stable / Acceptable / Suboptimal / High Risk |
| **Leak severity classification** | Tiered leak assessment (None / Mild / Moderate / Severe) with a leak consistency index |
| **Compliance risk score** | Rolling 14-night usage assessment against the CMS 4-hour threshold |
| **Residual burden tracking** | 30-night AHI trend analysis flagging sustained elevated burden |
| **Outlier detection** | Z-score based flagging of nights with statistically abnormal values |
| **Metric correlations** | 30-night Pearson r analysis: Leak↔AHI, Pressure↔AHI, Usage↔AHI, Pressure↔Leak, and a lag-1 therapy response index (Pressure night N → AHI night N+1) |
| **Insight narratives** | Auto-generated plain-English clinical explanations for flagged nights |

## Insights page

- Full per-night metric table across the selected range
- Average summary (AHI, usage, pressure, leak, ventilation, tidal volume)
- CMS 30-day compliance panel — rolling compliant night count vs. the 70% threshold
- Metric correlations panel — strength label and plain-English interpretation for each correlation pair
- Clinical insight narratives from the analytics engine

## PDF report export

The **Save Data Report** button (hover for description) generates a print-ready Letter-format PDF.

**Page 1 — Clinical Summary**
- Patient and device info strip (name, age, model, serial, firmware, therapy mode)
- Key KPIs: average AHI, average usage, leak P95 — each with a status indicator (good / warn / bad)
- Respiratory event profile (CAI, OAI, HI, RIN, snore index, pressure efficiency, nights analyzed)
- Adherence & 30-day CMS compliance panel
- Therapy Stability Score with tier label
- Metric Correlations card (when data is available)
- Metric calculation reference — formulas and clinical rationale for each key metric
- Clinician question checklist — five guided questions to raise at the appointment

**Page 2 — Trend Charts & Interpretation**
- All five trend charts rendered as images
- Clinician interpretation panel with correlation guide and Pearson r values with plain-English notes

## Multi-profile support

- Create, switch, and delete profiles for different patients or device configurations
- Each profile has its own isolated SQLite database and remembers the last-used data path
- Active profile is persisted securely between sessions using OS-level credential storage (Electron `safeStorage` → Windows Credential Manager)

## Data requirements

Import a folder copied from a compatible ResMed SD card. The folder must contain:

- `STR.edf` — summary statistics (required)
- `DATALOG/` — per-session EDF signal files
- `Identification.tgt` or `Identification.json` — device metadata

Compatible devices: **ResMed AirSense 10** and **AirSense 11** series.

## Tech stack

| Layer | Technology |
|-------|------------|
| Shell | Electron 36 |
| UI | React 19 + Vite 7 |
| Charts | Chart.js 4 |
| Database | SQLite via better-sqlite3 |
| Report templating | Handlebars |
| Packaging | electron-builder — NSIS (Windows), DMG (macOS), AppImage (Linux), x64 + arm64 |

## Runtime requirements (for users)

| Platform | Supported versions |
|----------|--------------------|
| **Windows** | 10 or 11 (x64 or arm64) |
| **macOS** | 11 Big Sur or later (Intel x64 or Apple Silicon arm64) |
| **Linux** | Any modern distro with FUSE support (x64 or arm64) — runs as AppImage, no install needed |

No internet connection required — all processing is local.

## Build your own installer

Each platform must be built on its matching OS — cross-compilation is not supported. The `npm run dist` command automatically targets the OS you're building on.

### Prerequisites

| Tool | Minimum version | All platforms | Windows only |
|------|-----------------|:---:|:---:|
| **Git** | any recent | ✓ | |
| **Node.js** | 22 LTS | ✓ | |
| **Python** | 3.12 | ✓ | |
| **Visual Studio Build Tools 2022** | — | | ✓ |

> **Windows — Visual Studio Build Tools**: run the installer and select the **"Desktop development with C++"** workload. Required by `node-gyp` to compile `better-sqlite3` native bindings.

Verify your environment:

```bash
node --version   # v22.x.x or higher
npm --version    # 10.x.x or higher
python --version # 3.12.x or higher
```

### 1. Clone and install dependencies

```bash
git clone https://github.com/GChavez0210/PAPLens.git
cd PAPLens
npm install
```

`npm install` automatically rebuilds the native `better-sqlite3` binary for your Electron version via the `postinstall` hook.

### 2. Build the installer

Run the appropriate command for your OS:

**Windows** — produces `release/PAPLens Setup x.x.x.exe` (NSIS):
```bash
npm run dist:win        # both x64 and arm64
npm run dist:win:x64    # x64 only
npm run dist:win:arm64  # arm64 only (Surface Pro X, Snapdragon)
```

**macOS** — produces `release/PAPLens-x.x.x.dmg` (Intel + Apple Silicon):
```bash
npm run dist:mac
```

**Linux** — produces `release/PAPLens-x.x.x.AppImage` (x64 + arm64):
```bash
npm run dist:linux
```

**Current OS (auto-detect):**
```bash
npm run dist
```

The build takes 2–5 minutes. Output goes to `release/`.

### 3. Run without installing (optional)

**Windows:**
```powershell
.\release\win-unpacked\PAPLens.exe
```

**macOS:**
```bash
open release/mac/PAPLens.app
```

**Linux:**
```bash
chmod +x release/PAPLens-*.AppImage && ./release/PAPLens-*.AppImage
```

### Troubleshooting

| Error | Fix |
|-------|-----|
| `gyp ERR! find Python` | Add Python to `PATH` or run `npm config set python /path/to/python` |
| `MSBuild not found` (Windows) | Open the Visual Studio Installer and confirm the **C++ build tools** workload is installed |
| `ELECTRON_RUN_AS_NODE` prevents startup | Run `$env:ELECTRON_RUN_AS_NODE=$null` (PowerShell) or `unset ELECTRON_RUN_AS_NODE` (bash) before `npm run dev` |
| AppImage won't run on Linux | Install FUSE: `sudo apt install libfuse2` (Debian/Ubuntu) or `sudo dnf install fuse` (Fedora) |
| Antivirus locks the output `.exe` | Temporarily pause real-time protection during packaging, or add `release/` to exclusions |

## Run in development mode

```bash
npm run dev
```

Opens the Vite dev server on `http://localhost:5173` and launches Electron pointing at it. Hot-reload is active for renderer changes; restart Electron for main-process changes.

## PDF report generation

PDF reports are generated in Electron main process using Handlebars + `report.html`, then rendered to PDF via `printToPDF`.

## Attribution

PAPLens uses and builds upon the parsing approach from:

- **CPAP Data Viewer** by Paul Solares: https://github.com/xpaulso/cpap-viewer

## Built with AI

This application was built using an AI-assisted development workflow powered by **[Antigravity](https://antigravity.google/)**, **[Claude Code](https://claude.ai)** and **[Codex](https://chatgpt.com/codex)**. AI accelerated the creation of the codebase, enabling faster iteration cycles and a consistent architecture across the project.

All system design, validation, and testing remain under developer control. The application runs locally and deterministically, with no external AI services involved during normal operation, ensuring reliability and data privacy.

PAPLens is an analytics/support tool and does not replace clinical diagnosis or medical decision-making.

## License

MIT. See [LICENSE](LICENSE).
