const { BrowserWindow, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

class WindowManager {
  constructor() {
    this.mainWindow = null;
  }

  resolveAssetPath(relativePath) {
    const devPath = path.join(__dirname, "..", "..", "..", relativePath);
    if (fs.existsSync(devPath)) return devPath;
    const packagedPath = path.join(process.resourcesPath, "app.asar", relativePath);
    if (fs.existsSync(packagedPath)) return packagedPath;
    return devPath;
  }

  createMainWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.focus();
      return this.mainWindow;
    }

    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      backgroundColor: "#07111f",
      webPreferences: {
        preload: path.join(__dirname, "..", "..", "preload", "index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      },
      title: "PAPLens",
      icon: this.resolveAssetPath(path.join("Assets", "PAPLens.ico"))
    });

    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

    this.mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    this.mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
      if (navigationUrl !== this.mainWindow.webContents.getURL()) {
        event.preventDefault();
      }
    });

    this.mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(`[renderer] ${message} (${sourceId}:${line})`);
      }
    });

    this.mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`[window] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
    });

    this.mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error("[window] render process gone:", details);
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      this.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      this.mainWindow.loadFile(path.join(__dirname, "..", "..", "..", "dist", "renderer", "index.html"));
    }

    this._buildMenu();

    return this.mainWindow;
  }

  _buildMenu() {
    const menu = Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      {
        label: "Help",
        submenu: [
          {
            label: "About PAPLens",
            click: () => {
              if (this.mainWindow) {
                this.mainWindow.webContents.send("app:show-about");
              }
            }
          }
        ]
      }
    ]);

    Menu.setApplicationMenu(menu);
  }

  getMainWindow() {
    return this.mainWindow;
  }
}

module.exports = { WindowManager };
