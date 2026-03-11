const { BrowserWindow } = require("electron");
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
            backgroundColor: "#09090b",
            webPreferences: {
                preload: path.join(__dirname, "..", "..", "preload", "index.js"),
                contextIsolation: true,
                nodeIntegration: false
            },
            title: "PAPLens",
            icon: this.resolveAssetPath(path.join("src", "renderer", "assets", "PLIcon.ico"))
        });

        this.mainWindow.on("closed", () => {
            this.mainWindow = null;
        });

        if (process.env.VITE_DEV_SERVER_URL) {
            this.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        } else {
            this.mainWindow.loadFile(path.join(__dirname, "..", "..", "..", "dist", "renderer", "index.html"));
        }

        return this.mainWindow;
    }

    getMainWindow() {
        return this.mainWindow;
    }
}

module.exports = { WindowManager };
