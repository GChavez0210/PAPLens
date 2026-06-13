# PAPLens (v1.7.0)

<p align="center">
  <img src="PAPLens-logo.png" alt="PAPLens Logo" width="250">
</p>

Desktop PAP/CPAP analytics for supported SD-card data, running fully offline.

Repository: https://github.com/GChavez0210/PAPLens

## Download

> **Releases page (recommended for most users):** Download a pre-built installer for your platform from the [GitHub Releases page](https://github.com/GChavez0210/PAPLens/releases). Releases are tested builds that have been verified before publishing.
>
> **Build from source:** If you want the latest unreleased changes, clone the repository and follow [Building PAPLens](docs/BUILDING.md). Builds from `main` may include work-in-progress changes not yet in a release.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Overview

PAPLens imports compatible PAP/CPAP SD-card data into a local profile database, runs analytics on the machine, and presents the results in dashboards, waveform views, insights, and printable PDF reports.

- Fully offline processing. No therapy data leaves the machine.
- Incremental imports into local SQLite profile databases.
- Multi-profile support for different patients or device configurations.
- Detects device model and metadata from supported device files.
- Tracks AHI, leak, pressure, usage, event breakdowns, ventilation, flow limitation, periodic breathing, SpO2, pulse, and related trend metrics when available.
- Includes dashboard charts, calendar heatmaps, clinical insights, compliance tracking, and EDF waveform viewing for supported ResMed sessions.
- Generates print-ready PDF reports intended for patient-to-clinician review.

More detail:

- [Feature reference](docs/FEATURES.md)
- [Supported devices and data requirements](docs/SUPPORTED_DEVICES.md)
- [Building PAPLens](docs/BUILDING.md)
- [Development notes](docs/DEVELOPMENT.md)

## Screenshots

![Screenshot 1](SCREENSHOTS/PL1.png)
![Screenshot 2](SCREENSHOTS/PL2.png)
![Screenshot 3](SCREENSHOTS/PL3.png)
![Screenshot 4](SCREENSHOTS/PL4.png)
![Screenshot 5](SCREENSHOTS/PL5.png)
![Screenshot 6](SCREENSHOTS/PL6.png)
![Screenshot 7](SCREENSHOTS/PL7.png)

## Attribution

PAPLens uses and builds upon the parsing approach from:

- **CPAP Data Viewer** by Paul Solares: https://github.com/xpaulso/cpap-viewer
- **OSCAR** loader plugins by The OSCAR Team: https://gitlab.com/pholy/OSCAR-code/-/tree/master/oscar/SleepLib/loader_plugins
- **cpap-parser** by open-cpap: https://gitlab.com/open-cpap/cpap-parser

See [NOTICES.md](NOTICES.md) for parser-specific attributions and license notes.

## Built with AI

This application was built using an AI-assisted development workflow powered by **[Antigravity](https://antigravity.google/)**, **[Claude Code](https://claude.ai)** and **[Codex](https://chatgpt.com/codex)**. System design, validation, and testing remain under developer control.

PAPLens is an analytics/support tool and does not replace clinical diagnosis or medical decision-making.

## License

GPL-3.0-only. See [LICENSE](LICENSE) and [NOTICES.md](NOTICES.md).
