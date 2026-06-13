# Building PAPLens

Use the GitHub Releases page for tested installers. Build from source when you want the latest unreleased code from `main`.

Each platform must be built on its matching OS. Cross-compilation is not supported. Build output goes to `release/`.

## Runtime Requirements

| Platform | Supported versions |
|----------|--------------------|
| Windows | 10 or 11, x64 or arm64 |
| macOS | 11 Big Sur or later, Intel x64 or Apple Silicon arm64 |
| Linux | Any modern distro with FUSE support, x64 or arm64 |

No internet connection is required while using the app. All processing is local.

## Build Prerequisites

| Tool | Minimum version | All platforms | Windows only |
|------|-----------------|:---:|:---:|
| Git | any recent | Yes | |
| Node.js | 22 LTS | Yes | |
| Python | 3.12 | Yes | |
| Visual Studio Build Tools 2022 | Current | | Yes |

On Windows, install Visual Studio Build Tools with the "Desktop development with C++" workload. It is required by `node-gyp` to compile `better-sqlite3` native bindings.

Verify your environment:

```bash
node --version
npm --version
python --version
```

## Install Dependencies

```bash
git clone https://github.com/GChavez0210/PAPLens.git
cd PAPLens
npm install
```

`npm install` automatically rebuilds the native `better-sqlite3` binary for the Electron version through the `postinstall` hook.

## Build Installers

Windows:

```bash
npm run dist:win        # both x64 and arm64
npm run dist:win:x64    # x64 only
npm run dist:win:arm64  # arm64 only
```

macOS:

```bash
npm run dist:mac
```

Linux:

```bash
npm run dist:linux
```

Current OS:

```bash
npm run dist
```

## Run Without Installing

Windows:

```powershell
.\release\win-unpacked\PAPLens.exe
```

macOS:

```bash
open release/mac/PAPLens.app
```

Linux:

```bash
chmod +x release/PAPLens-*.AppImage
./release/PAPLens-*.AppImage
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `gyp ERR! find Python` | Add Python to `PATH` or run `npm config set python /path/to/python` |
| `MSBuild not found` on Windows | Open the Visual Studio Installer and confirm the C++ build tools workload is installed |
| `ELECTRON_RUN_AS_NODE` prevents startup | Clear it before launching: `$env:ELECTRON_RUN_AS_NODE=$null` in PowerShell or `unset ELECTRON_RUN_AS_NODE` in bash |
| AppImage will not run on Linux | Install FUSE: `sudo apt install libfuse2` on Debian/Ubuntu or `sudo dnf install fuse` on Fedora |
| Antivirus locks the output `.exe` | Temporarily pause real-time protection during packaging, or add `release/` to exclusions |
