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

The DeVilbiss IntelliPAP DV6 loader in [electron/main/loaders/devilbiss-loader.js](electron/main/loaders/devilbiss-loader.js) is adapted from open-cpap's Rust parser implementation:

https://gitlab.com/open-cpap/cpap-parser

The cpap-parser project is licensed under GNU General Public License v3.0 or later.

## Parser Status

The Resvent and DeVilbiss integrations are beta support: they provide summary-level imports for PAPLens analytics, but they do not yet provide PAPLens session waveform viewing and need broader real-device validation.
