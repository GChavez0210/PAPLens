const { app, BrowserWindow } = require("electron");
const { AppDatabase, ProfileDatabase } = require("./services/database");
const { SecureSettings } = require("./services/secure-settings");
const { AppContainer } = require("./container");
const { WindowManager } = require("./services/windowManager");
const { CpapService } = require("./services/cpapService");
const { IpcRouter } = require("./services/ipcRouter");

// We no longer have global mutable state. Everything goes into the container.
const appContainer = new AppContainer();

app.whenReady().then(async () => {
  const windowManager = new WindowManager();
  appContainer.register("windowManager", windowManager);

  const appDatabase = new AppDatabase(app.getPath("userData"));
  appContainer.register("appDatabase", appDatabase);

  const secureSettings = new SecureSettings(appDatabase);
  appContainer.register("secureSettings", secureSettings);

  const cpapService = new CpapService(appContainer);
  appContainer.register("cpapService", cpapService);

  const savedProfileId = secureSettings.getDecrypted("activeProfileId");
  appContainer.register("activeProfileId", savedProfileId || null);

  if (savedProfileId) {
    const profileDb = new ProfileDatabase(app.getPath("userData"), savedProfileId);
    appContainer.register("profileDatabase", profileDb);
    await cpapService.hydrateSummaryFromDatabase();
  } else {
    appContainer.register("profileDatabase", null);
  }

  const ipcRouter = new IpcRouter(appContainer);
  ipcRouter.register();
  appContainer.register("ipcRouter", ipcRouter);

  windowManager.createMainWindow();
});

app.on("window-all-closed", async () => {
  await appContainer.shutdown();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const wm = appContainer.get("windowManager");
    if (wm) wm.createMainWindow();
  }
});
