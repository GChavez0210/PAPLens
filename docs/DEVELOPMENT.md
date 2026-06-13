# PAPLens Development Notes

## Tech Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron 36 |
| UI | React 19 + Vite 7 |
| Charts | Chart.js 4 |
| Database | SQLite via better-sqlite3 |
| Report templating | Handlebars |
| Packaging | electron-builder for NSIS, DMG, and AppImage outputs |

## Run In Development Mode

```bash
npm run dev
```

This opens the Vite dev server on `http://localhost:5173` and launches Electron against it. Renderer changes hot-reload. Main-process changes require restarting Electron.

## Development Checks

```bash
npm run lint
npm test
npm run check
```

`tsconfig.json` is kept as a no-emit JavaScript type-checking and IDE configuration for `src/`.

## Test Notes

- Unit tests live next to their source files under `electron/main/**` and `src/**`.
- `npm test` runs the Node test suite.
- Report template binding smoke checks live in `scripts/sim_compile.js`.
- `npm run test-types` is available for an explicit type-checking pass, but is intentionally not included in `npm run check`.
- There are no renderer unit tests; use `npm run lint` and Vite build checks to validate renderer changes.

## PDF Report Generation

PDF reports are generated in the Electron main process using Handlebars and `report.html`, then rendered to PDF with `printToPDF`.
