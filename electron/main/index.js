const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { CPAPDataLoader } = require("./services/cpap-data-loader");
const { AppDatabase, ProfileDatabase } = require("./services/database");
const { SecureSettings } = require("./services/secure-settings");
const { resolveHost, probeTcp, getNodeVersionFromChildProcess } = require("./services/diagnostics");

let mainWindow = null;
let currentDataPath = null;
let dataLoader = null;
let currentSummary = null;
let appDatabase = null;
let currentProfileDatabase = null;
let activeProfileId = null;
let secureSettings = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: "PAPLens",
    icon: path.join(__dirname, "..", "..", "build", "PAPLens.ico")
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "renderer", "index.html"));
  }
}

const { IncrementalImporter } = require("./services/incremental-import");
const { AnalyticsOrchestrator } = require("./analytics/orchestrator");

async function loadDataFromPath(dataPath) {
  if (!currentProfileDatabase) {
    console.warn("Attempted to load data without active profile database.");
    return null;
  }
  const importer = new IncrementalImporter(currentProfileDatabase.db, dataPath);
  const result = await importer.runImport();
  if (!result.success) {
    return { error: result.error };
  }
  const summary = result.summary;
  currentSummary = summary;
  currentDataPath = dataPath;
  dataLoader = importer.loader; // Provide fallback for IPC mapping like getDailyStats()

  if (result.deviceId) {
    // Check if there are missing nights in derived_metrics that we need to compute anyway
    const missingNights = currentProfileDatabase.db.prepare(`
      SELECT n.night_date 
      FROM nights n
      LEFT JOIN derived_metrics d ON d.night_id = n.id
      WHERE n.device_id = ? AND (d.night_id IS NULL OR d.therapy_stability_score IS NULL)
      ORDER BY n.night_date DESC LIMIT 90
    `).all(result.deviceId).map(r => r.night_date);

    const nightsToRun = new Set([...result.runAnalyticsOn, ...missingNights]);

    if (nightsToRun.size > 0) {
      const orchestrator = new AnalyticsOrchestrator(currentProfileDatabase.db);
      await orchestrator.runForNights(result.deviceId, Array.from(nightsToRun));
    }

    // Hydrate summary with latest clinical scores from DB
    const dbStats = currentProfileDatabase.db.prepare(`
      SELECT n.night_date, d.therapy_stability_score, d.leak_severity_tier, d.leak_consistency_index
      FROM nights n
      JOIN derived_metrics d ON d.night_id = n.id
      WHERE n.device_id = ?
    `).all(result.deviceId);

    const scoreMap = new Map(dbStats.map(s => [s.night_date, s]));
    if (summary.dailyStats) {
      summary.dailyStats.forEach(day => {
        const score = scoreMap.get(day.date);
        if (score) {
          day.therapy_stability_score = score.therapy_stability_score;
          day.leak_severity_tier = score.leak_severity_tier;
          day.leak_consistency_index = score.leak_consistency_index;
        }
      });
    }
  }

  console.log(`Incremental Import finished. Inserted: ${result.insertedCount}, Updated: ${result.updatedCount}`);

  secureSettings.setEncrypted("lastDataPath", dataPath);
  if (mainWindow) {
    mainWindow.webContents.send("cpap:data-loaded", summary);
  }
  return summary;
}

function registerIpc() {
  ipcMain.handle("cpap:select-data-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select CPAP Data Directory"
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "No directory selected" };
    }
    const selectedPath = result.filePaths[0];
    if (!fs.existsSync(path.join(selectedPath, "STR.edf"))) {
      return { success: false, error: "STR.edf not found in selected directory" };
    }
    const summary = await loadDataFromPath(selectedPath);
    return { success: true, path: selectedPath, summary };
  });

  ipcMain.handle("cpap:load-data-folder", async (_event, folderPath) => {
    if (!folderPath || !fs.existsSync(path.join(folderPath, "STR.edf"))) {
      return { success: false, error: "Invalid CPAP folder path" };
    }
    const summary = await loadDataFromPath(folderPath);
    return { success: true, summary };
  });

  ipcMain.handle("cpap:get-summary", async () => {
    return currentSummary;
  });

  ipcMain.handle("cpap:get-daily-stats", async () => {
    if (!dataLoader) {
      return [];
    }
    return dataLoader.getDailyStats();
  });

  ipcMain.handle("cpap:get-session-detail", async (_event, sessionId) => {
    if (!dataLoader) {
      return { error: "No data loaded" };
    }
    return dataLoader.loadSessionDetail(sessionId);
  });

  ipcMain.handle("cpap:refresh", async () => {
    if (!currentDataPath) {
      return { success: false, error: "No data path configured" };
    }
    const summary = await loadDataFromPath(currentDataPath);
    return { success: true, summary };
  });

  ipcMain.handle("cpap:save-report", async (_event, reportData) => {
    if (!mainWindow) return { success: false, error: "No active window" };

    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: "Export Report as PDF",
        defaultPath: "PAPLens_Report.pdf",
        filters: [{ name: "PDF Files", extensions: ["pdf"] }]
      });

      if (canceled || !filePath) return { success: false, error: "Cancelled" };

      const Handlebars = require("handlebars");
      const isDev = !app.isPackaged;
      const templatePath = isDev ? path.join(__dirname, "..", "..", "report.html") : path.join(process.resourcesPath, "app.asar", "report.html");
      const templateStr = fs.readFileSync(templatePath, "utf8");
      const template = Handlebars.compile(templateStr);

      if (currentProfileDatabase && reportData && reportData.device) {
        const db = currentProfileDatabase.db;
        const deviceId = db.prepare('SELECT id FROM devices WHERE serial_number = ?').get(reportData.device.serialNumber)?.id;

        if (deviceId) {
          const logoPath = isDev ? path.join(__dirname, "..", "..", "ReportLogo.png") : path.join(process.resourcesPath, "app.asar", "ReportLogo.png");
          let logoDataUri = "";
          try {
            const logoBuffer = fs.readFileSync(logoPath);
            logoDataUri = `data:image/png;base64,${logoBuffer.toString("base64")}`;
          } catch (err) {
            console.error("ReportLogo.png not found", err);
          }
          reportData.header = { logoUrl: logoDataUri };

          const windowDays = reportData.report.windowDays || 30;

          reportData.tables = { nights: [] };
          let nights;
          if (reportData.report.startDate && reportData.report.endDate) {
            nights = db.prepare(`
              SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage, m.pressure_median AS pressure, m.leak_p50 AS leak, m.minute_vent_p50 AS mv, m.resp_rate_p50 AS rr, m.tidal_vol_p50 AS tv
              FROM nights n
              JOIN night_metrics m ON m.night_id = n.id
              WHERE n.device_id = ? AND n.night_date >= ? AND n.night_date <= ?
              ORDER BY n.night_date DESC
            `).all(deviceId, reportData.report.startDate, reportData.report.endDate);
          } else {
            const limit = reportData.report.rangeLabel === "All Time" ? 9999 : windowDays;
            nights = db.prepare(`
              SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage, m.pressure_median AS pressure, m.leak_p50 AS leak, m.minute_vent_p50 AS mv, m.resp_rate_p50 AS rr, m.tidal_vol_p50 AS tv
              FROM nights n
              JOIN night_metrics m ON m.night_id = n.id
              WHERE n.device_id = ?
              ORDER BY n.night_date DESC
              LIMIT ?
            `).all(deviceId, limit);
          }

          reportData.tables.nights = nights.map(n => ({
            date: n.date,
            ahi: Number(n.ahi || 0).toFixed(1),
            usage: Number(n.usage || 0).toFixed(1),
            pressure: Number(n.pressure || 0).toFixed(1),
            leak: Number(n.leak || 0).toFixed(1),
            mv: Number(n.mv || 0).toFixed(1),
            rr: Number(n.rr || 0).toFixed(1),
            tv: Number(n.tv || 0).toFixed(1)
          }));

          const count = nights.length || 1;
          const avgAhi = nights.reduce((sum, n) => sum + (n.ahi || 0), 0) / count;
          const avgUsage = nights.reduce((sum, n) => sum + (n.usage || 0), 0) / count;
          const sortedLeaks = nights.map(n => n.leak || 0).sort((a, b) => a - b);
          const p50Leak = sortedLeaks[Math.floor(sortedLeaks.length / 2)] || 0;

          reportData.summary = {
            ahiAvg: avgAhi.toFixed(1),
            ahiBadgeClass: avgAhi > 15 ? "crit" : avgAhi > 5 ? "warn" : "",
            ahiBadgeLabel: avgAhi > 15 ? "Severe" : avgAhi > 5 ? "Elevated" : "Adequate",
            usageAvg: avgUsage.toFixed(1),
            complianceBadgeClass: avgUsage < 4 ? "crit" : "",
            complianceBadgeLabel: avgUsage < 4 ? "Low Usage" : "Good",
            leakTypical: p50Leak.toFixed(1),
            leakBadgeClass: p50Leak > 24 ? "warn" : "",
            leakBadgeLabel: p50Leak > 24 ? "Elevated" : "Normal",
          };

          const lastNight = db.prepare(`
            SELECT d.stability_score, d.mask_fit_score, d.compliance_risk, d.outliers
            FROM nights n
            JOIN derived_metrics d ON d.night_id = n.id
            WHERE n.device_id = ?
            ORDER BY n.night_date DESC LIMIT 1
          `).get(deviceId);

          if (lastNight) {
            reportData.summary.stabilityAvg = lastNight.stability_score || "-";
            reportData.summary.maskFitAvg = lastNight.mask_fit_score || "-";
            reportData.summary.complianceRisk = String(lastNight.compliance_risk || "Unknown").toUpperCase();
            reportData.summary.riskBadgeClass = lastNight.compliance_risk === 'high' ? 'crit' : lastNight.compliance_risk === 'medium' ? 'warn' : '';
            reportData.summary.riskBadgeLabel = reportData.summary.complianceRisk;
            reportData.summary.narrative = "Therapy dynamics show generally stable respiratory indices, with minor positional variability.";
          }

          const insights = db.prepare(`
            SELECT title, summary AS result, details AS comment
            FROM insights_explanations
            WHERE night_id = (SELECT id FROM nights WHERE device_id = ? ORDER BY night_date DESC LIMIT 1)
          `).all(deviceId);
          reportData.insights = { keyFindings: insights };

          reportData.outliers = { hasOutliers: false, items: [] };
          let outlierRecords;
          if (reportData.report.startDate && reportData.report.endDate) {
            outlierRecords = db.prepare(`
              SELECT n.night_date, d.outliers
              FROM nights n
              JOIN derived_metrics d ON d.night_id = n.id
              WHERE n.device_id = ? AND d.outliers != '[]' AND n.night_date >= ? AND n.night_date <= ?
              ORDER BY n.night_date DESC
            `).all(deviceId, reportData.report.startDate, reportData.report.endDate);
          } else {
            const limit = reportData.report.rangeLabel === "All Time" ? 9999 : windowDays;
            outlierRecords = db.prepare(`
              SELECT n.night_date, d.outliers
              FROM nights n
              JOIN derived_metrics d ON d.night_id = n.id
              WHERE n.device_id = ? AND d.outliers != '[]'
              ORDER BY n.night_date DESC LIMIT ?
            `).all(deviceId, limit);
          }

          if (outlierRecords.length > 0) {
            reportData.outliers.hasOutliers = true;
            reportData.outliers.items = outlierRecords.map(r => {
              let parsed = [];
              try { parsed = JSON.parse(r.outliers); } catch (e) { }
              return {
                date: r.night_date,
                severity: "Warning",
                metrics: parsed.map(p => p.metric).join(", ")
              };
            });
          }

          const corrs = db.prepare(`SELECT results FROM correlations WHERE device_id = ? ORDER BY rowid DESC LIMIT 1`).get(deviceId);
          reportData.correlations = { caption: "Linear correlation over the last 30 days.", items: [] };
          if (corrs) {
            try {
              const items = JSON.parse(corrs.results);
              reportData.correlations.items = items.map(c => ({
                pair: c.pair, r: c.r.toFixed(2), n: 30, label: c.r > 0.4 ? "Positive Correlation" : c.r < -0.4 ? "Negative Correlation" : "Weak/None"
              }));
            } catch (e) { }
          }

          const sortedAhis = nights.map(n => n.ahi || 0).sort((a, b) => a - b);
          reportData.burden = {
            summaryLine: `AHI > 5 occurred on ${nights.filter(n => n.ahi > 5).length} nights.`,
            nightsOver5: nights.filter(n => n.ahi > 5).length,
            nightsOver10: nights.filter(n => n.ahi > 10).length,
            ahiP95: sortedAhis[Math.floor(sortedAhis.length * 0.95)]?.toFixed(1) || 0
          };

          const defaultLogoPath = path.join(__dirname, "..", "..", "src", "assets", "PAPLens-logo.png");
          if (fs.existsSync(defaultLogoPath)) {
            const logof = fs.readFileSync(defaultLogoPath);
            reportData.brand = { logoDataUri: "data:image/png;base64," + logof.toString('base64') };
          }
        }
      }

      const compiledHtml = template(reportData || {});

      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });

      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(compiledHtml)}`);

      const pdfData = await printWin.webContents.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        pageSize: "A4",
      });

      printWin.close();
      fs.writeFileSync(filePath, pdfData);
      return { success: true, filePath };
    } catch (err) {
      console.error("PDF Export failed:", err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle("cpap:set-time-filter", async (_event, dayStartHour, dayEndHour) => {
    if (!dataLoader) {
      return { success: false, error: "No data loaded" };
    }
    dataLoader.setDayBoundary(dayStartHour, dayEndHour);
    const summary = dataLoader.getSummary();
    currentSummary = summary;
    if (mainWindow) {
      mainWindow.webContents.send("cpap:data-loaded", summary);
    }
    return { success: true, summary };
  });

  ipcMain.handle("app:get-last-data-path", async () => {
    return secureSettings.getDecrypted("lastDataPath");
  });

  // Analytics Endpoints
  ipcMain.handle("cpap:get-last-night-overview", async () => {
    if (!currentProfileDatabase || !currentSummary?.deviceInfo?.serialNumber) return null;
    const serial = currentSummary.deviceInfo.serialNumber;
    const device = currentProfileDatabase.db.prepare(`SELECT id FROM devices WHERE serial_number = ?`).get(serial);
    if (!device) return null;

    const lastNight = currentProfileDatabase.db.prepare(`
      SELECT
        n.id AS night_id, n.night_date,
        m.ahi_total, m.pressure_median, m.leak_p50, n.usage_hours,
        d.stability_score, d.therapy_stability_score, d.mask_fit_score, d.compliance_risk, d.outliers
      FROM nights n
      JOIN night_metrics m ON m.night_id = n.id
      LEFT JOIN derived_metrics d ON d.night_id = n.id
      WHERE n.device_id = ?
      ORDER BY n.night_date DESC
      LIMIT 1
    `).get(device.id);


    if (!lastNight) return null;

    const last7 = currentProfileDatabase.db.prepare(`
      SELECT n.night_date AS date, m.ahi_total AS ahi
      FROM nights n
      JOIN night_metrics m ON m.night_id = n.id
      WHERE n.device_id = ?
      ORDER BY n.night_date DESC
      LIMIT 7
    `).all(device.id).reverse();

    return { ...lastNight, last7 };
  });


  ipcMain.handle("cpap:get-insights", async (_event, payload) => {
    if (!currentProfileDatabase || !currentSummary?.deviceInfo?.serialNumber) return null;
    const serial = currentSummary.deviceInfo.serialNumber;
    const device = currentProfileDatabase.db.prepare(`SELECT id FROM devices WHERE serial_number = ?`).get(serial);
    if (!device) return null;

    const { days = 30, from = null, to = null } = payload || {};

    let trendRows;
    if (from && to) {
      trendRows = currentProfileDatabase.db.prepare(`
        SELECT
          n.night_date, m.ahi_total, n.usage_hours, m.pressure_median, m.leak_p50,
          m.minute_vent_p50, m.resp_rate_p50, m.tidal_vol_p50,
          d.residual_burden
        FROM nights n
        JOIN night_metrics m ON m.night_id = n.id
        LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.night_date BETWEEN ? AND ?
        ORDER BY n.night_date DESC
      `).all(device.id, from, to);
    } else {
      const limit = days === 0 ? 99999 : days;
      trendRows = currentProfileDatabase.db.prepare(`
        SELECT
          n.night_date, m.ahi_total, n.usage_hours, m.pressure_median, m.leak_p50,
          m.minute_vent_p50, m.resp_rate_p50, m.tidal_vol_p50,
          d.residual_burden
        FROM nights n
        JOIN night_metrics m ON m.night_id = n.id
        LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ?
        ORDER BY n.night_date DESC
        LIMIT ?
      `).all(device.id, limit);
    }

    const corrWindow = (days >= 30 || days === 0) ? 30 : 7;
    const latestCorrs = currentProfileDatabase.db.prepare(`
      SELECT results FROM correlations
      WHERE device_id = ? AND window_days = ?
      ORDER BY computed_at DESC
      LIMIT 1
    `).get(device.id, corrWindow);

    // Get the most recent non-empty insights_explanations
    const explanations = currentProfileDatabase.db.prepare(`
      SELECT title, summary, details, key, night_id 
      FROM insights_explanations 
      WHERE night_id IN (
        SELECT id FROM nights WHERE device_id = ? ORDER BY night_date DESC LIMIT 7
      )
      ORDER BY created_at DESC
      LIMIT 10
    `).all(device.id);

    return {
      trends: trendRows,
      correlations: latestCorrs ? JSON.parse(latestCorrs.results) : [],
      explanations
    };
  });

  ipcMain.handle("app:get-profiles", () => {
    return appDatabase.getProfiles();
  });

  ipcMain.handle("app:create-profile", (_event, { id, name, age, notes }) => {
    appDatabase.createProfile(id, name, age, notes);
    return { success: true };
  });

  ipcMain.handle("app:set-active-profile", (_event, profileId) => {
    if (currentProfileDatabase) {
      currentProfileDatabase.close();
      currentProfileDatabase = null;
    }
    currentSummary = null;
    dataLoader = null;
    currentDataPath = null;
    if (profileId) {
      currentProfileDatabase = new ProfileDatabase(app.getPath("userData"), profileId);
      activeProfileId = profileId;
      secureSettings.setEncrypted("activeProfileId", profileId);
    }
    return { success: true };
  });

  ipcMain.handle("app:get-active-profile", () => {
    if (!activeProfileId) return null;
    return appDatabase.getProfile(activeProfileId);
  });

  ipcMain.handle("diag:resolve-host", async (_event, hostname) => {
    return resolveHost(hostname);
  });

  ipcMain.handle("diag:tcp-probe", async (_event, host, port, timeoutMs) => {
    return probeTcp(host, port, timeoutMs);
  });

  ipcMain.handle("diag:node-version", async () => {
    return getNodeVersionFromChildProcess();
  });
}

app.whenReady().then(async () => {
  appDatabase = new AppDatabase(app.getPath("userData"));
  secureSettings = new SecureSettings(appDatabase);
  registerIpc();
  createMainWindow();

  const savedProfileId = secureSettings.getDecrypted("activeProfileId");
  if (savedProfileId) {
    activeProfileId = savedProfileId;
    currentProfileDatabase = new ProfileDatabase(app.getPath("userData"), savedProfileId);
  }

  const lastPath = secureSettings.getDecrypted("lastDataPath");
  if (lastPath && fs.existsSync(path.join(lastPath, "STR.edf"))) {
    await loadDataFromPath(lastPath);
    return;
  }
});

app.on("window-all-closed", () => {
  if (appDatabase) appDatabase.close();
  if (currentProfileDatabase) currentProfileDatabase.close();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
