# Notices and Attributions

PAPLens includes parser adaptations derived from GPL-licensed CPAP parser projects. Those integrations require PAPLens to be distributed under the GNU General Public License version 3. See [LICENSE](LICENSE).

## PAPLens

Copyright (c) 2026 Gabriel Chavez.

Earlier PAPLens code was distributed under the MIT License. The project-level license is now GPL-3.0-only because the application includes GPL-derived parser integrations.

## CPAP Data Viewer

PAPLens uses and builds upon the parsing approach from CPAP Data Viewer by Paul Solares:

https://github.com/xpaulso/cpap-viewer

## OSCAR

The Resvent iBreezer / Hoffrichter Point 3 loader in [electron/main/loaders/resvent-loader.js](electron/main/loaders/resvent-loader.js) is adapted from OSCAR's `resvent_loader.cpp` implementation:

https://gitlab.com/pholy/OSCAR-code/-/blob/master/oscar/SleepLib/loader_plugins/resvent_loader.cpp

OSCAR is licensed under the GNU General Public License version 3. The upstream loader file identifies copyright ownership by The OSCAR Team.

## open-cpap cpap-parser

The DeVilbiss IntelliPAP DV6 loader in [electron/main/loaders/devilbiss-loader.js](electron/main/loaders/devilbiss-loader.js), Fisher & Paykel SleepStyle / ICON loader in [electron/main/loaders/fisher-paykel-loader.js](electron/main/loaders/fisher-paykel-loader.js), Lowenstein Medical / Weinmann loader in [electron/main/loaders/lowenstein-loader.js](electron/main/loaders/lowenstein-loader.js), Löwenstein Prisma Line loader in [electron/main/loaders/prisma-line-loader.js](electron/main/loaders/prisma-line-loader.js) (derived from cpap-parser's `src/parsers/prisma_line.rs`), Apex Medical loader in [electron/main/loaders/apex-loader.js](electron/main/loaders/apex-loader.js) (derived from `src/parsers/apex.rs`), BMC / 3B RESmart loader in [electron/main/loaders/bmc-loader.js](electron/main/loaders/bmc-loader.js) (derived from `src/parsers/bmc.rs`), and Yuwell loader in [electron/main/loaders/yuwell-loader.js](electron/main/loaders/yuwell-loader.js) (derived from `src/parsers/yuwell.rs`) are adapted from open-cpap's parser implementations:

https://gitlab.com/open-cpap/cpap-parser

The cpap-parser project is licensed under GNU General Public License v3.0 or later.

## Parser Status

The Resvent, DeVilbiss, Fisher & Paykel, Lowenstein, Löwenstein Prisma Line, Apex Medical, BMC / 3B RESmart, and Yuwell integrations are beta support: they provide summary-level imports for PAPLens analytics, but they do not yet provide PAPLens session waveform viewing and need broader real-device validation.

The minimal ZIP archive reader in [electron/main/parsers/zip-reader.js](electron/main/parsers/zip-reader.js) (used by the Prisma Line loader to read `config.pcfg` / `therapy.pdat` containers) is an original implementation built on Node's `zlib` module; it is not derived from third-party code.
