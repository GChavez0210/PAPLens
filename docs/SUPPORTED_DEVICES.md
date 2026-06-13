# Supported Devices and Data Requirements

PAPLens imports folders copied from compatible PAP/CPAP SD cards. Support depth depends on the device family and the available on-card data format.

## Support Tiers

| Tier | Implementation difficulty | Maturity |
|------|--------------------------|----------|
| Supported | Primary development target. Every feature is built and exercised against real ResMed data. | Production-grade. Incremental import, full analytics pipeline, EDF session waveform viewer, profile-local cache, and report export all work. Regression-tested on every build. |
| Beta | Summary-level parser support adapted from upstream parser behavior and local fixtures. | Summary import and trend analytics work. Session waveform viewing is not available unless the device writes compatible EDF signal files. Real-world field reports may surface firmware or SD-card layout edge cases. |
| Alpha | Proprietary, undocumented, encrypted, or otherwise unported formats. | Not integrated. Upstream parsing logic may exist, but it has not been ported or validated for PAPLens. |

## Device Support Matrix

| Status | Device family | What works in PAPLens |
|--------|---------------|-----------------------|
| Supported | ResMed AirSense 10 / AirSense 11 / AirCurve 10 / AirCurve 11, EDF SD cards | Full summary import, all metrics and analytics, EDF session waveform viewer, profile-local session cache, PDF report export |
| Beta | Resvent iBreezer / Hoffrichter Point 3 | Summary import: AHI, OAI, CAI, HI, usage hours, pressure P50/P95, leak P50/P95, minute ventilation P50/P95, tidal volume P50/P95, respiratory rate P50/P95. No session waveform viewer. |
| Beta | DeVilbiss IntelliPAP DV6 | Summary import: AHI, OAI, CAI, HI, usage hours, pressure P50/P95, leak P50/P95, tidal volume, respiratory rate, flow limitation fraction. No session waveform viewer. |
| Beta | Fisher & Paykel SleepStyle / ICON | Summary import: usage hours and pressure P50/P95. AHI, leak, and event details are not exposed by this summary path. No session waveform viewer. |
| Beta | Lowenstein Medical / Weinmann `WM_DATA.TDF` devices | Summary import: AHI, OAI, CAI, HI, usage hours, pressure P50/P95, leak P50/P95, snore index, and flow limitation. No session waveform viewer. |
| Beta | Lowenstein Prisma Line, including prisma25 / Eyra | Summary import: usage hours, set pressure, therapy mode, and per-day AHI/OAI/CAI/HI. No session waveform viewer. |
| Beta | Apex Medical XT / XT Auto / iCH / Spirit | Summary import: usage hours, set/percentile pressure, therapy mode, per-day AHI/OAI/CAI/HI, leak P50/P95, snore index, and flow-limitation index. No session waveform viewer. |
| Beta | BMC / 3B Medical RESmart, GI / GII | Summary import: usage hours and per-day AHI/OAI/CAI/HI. Pressure and leak are not reported. No session waveform viewer. |
| Beta | Yuwell YH-360 / YH-450 / YH-550 / YH-680 and variants | Summary import: usage hours, per-day AHI/OAI/CAI/HI, and average pressure across four on-card data layouts. Leak and percentile pressures are not exposed. No session waveform viewer. |
| Alpha | Philips Respironics System One / DreamStation / PRS1, M-Series | Not yet supported. OSCAR has GPL loader plugins for these families, but the proprietary format has not been ported or validated for PAPLens. |
| Alpha | HDM Z1 / Z2, React Health / Human Design Medical | Not yet supported. The Z1/Z2 on-card format has not been ported or validated for PAPLens. |

## Known Beta Limitations

- Beta imports are summary-level only unless otherwise noted.
- Devices without compatible EDF signal files do not support the session waveform viewer.
- Resvent pressure and leak percentiles are derived from 2-4 Hz P-file waveform data. Firmware variants may write different channel names or omit P files.
- Fisher & Paykel, Lowenstein, Prisma Line, Apex, BMC, and Yuwell support is validated primarily with synthetic fixtures derived from upstream parser behavior. Real SD cards are needed to harden firmware variants and edge cases.
- DeVilbiss `DV6/S.BIN` is a rolling buffer, so older nights may be overwritten. Leak values are stored as single-byte tenths of L/min and may be capped on unusually high-leak nights.

## Data Requirements

Import a folder copied from a compatible SD card.

### ResMed

ResMed folders must contain:

- `STR.edf`: summary statistics, required.
- `DATALOG/`: per-session EDF signal files.
- `Identification.tgt` or `Identification.json`: device metadata.

### Other Device Families

| Device family | Detection path |
|---------------|----------------|
| Resvent | `THERAPY/CONFIG/` plus `THERAPY/RECORD/` |
| DeVilbiss IntelliPAP DV6 | `DV6/S.BIN` |
| Fisher & Paykel SleepStyle / ICON | `FPHCARE/ICON/<serial>/SUM*.fph` |
| Lowenstein Medical / Weinmann | `WM_DATA.TDF` at the SD-card root |
| Lowenstein Prisma Line | `config.pcfg` at the SD-card root, with daily data in `therapy.pdat` |
| Apex Medical | `APDATA/` containing one or more `<YYYYMMDD>.APC` session files |
| BMC / 3B RESmart | `<serial>.USR` alongside matching `<serial>.idx` and `<serial>.000` files |
| Yuwell | `RunLog.bys` with `YH-*` folders, `YHSD-NEW.BYS`, or `YH-*` folders containing `.BYS` session files |
