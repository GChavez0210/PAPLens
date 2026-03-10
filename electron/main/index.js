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

function resolveAssetPath(relativePath) {
  const devPath = path.join(__dirname, "..", "..", relativePath);
  if (fs.existsSync(devPath)) return devPath;
  const packagedPath = path.join(process.resourcesPath, "app.asar", relativePath);
  if (fs.existsSync(packagedPath)) return packagedPath;
  return devPath;
}

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
    icon: resolveAssetPath(path.join("src", "renderer", "assets", "PLIcon.ico"))
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "renderer", "index.html"));
  }
}

const { IncrementalImporter } = require("./services/incremental-import");
const { AnalyticsOrchestrator } = require("./analytics/orchestrator");

function parseJsonSafely(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

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
      WHERE n.device_id = ? AND n.usage_hours > 0 AND (d.night_id IS NULL OR d.therapy_stability_score IS NULL)
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

  if (mainWindow) {
    mainWindow.webContents.send("cpap:data-loaded", summary);
  }
  return summary;
}

function getLatestImportedPath(profileDatabase = currentProfileDatabase) {
  if (!profileDatabase) return null;
  const row = profileDatabase.db.prepare(`
    SELECT folder_path
    FROM import_log
    WHERE folder_path IS NOT NULL AND folder_path != ''
    ORDER BY import_timestamp DESC
    LIMIT 1
  `).get();
  return row?.folder_path || null;
}

function getLatestDevice(profileDatabase = currentProfileDatabase) {
  if (!profileDatabase) return null;

  const latestImportedDevice = profileDatabase.db.prepare(`
    SELECT d.*
    FROM import_log i
    JOIN devices d ON d.id = i.device_id
    WHERE i.device_id IS NOT NULL
    ORDER BY i.import_timestamp DESC
    LIMIT 1
  `).get();

  if (latestImportedDevice) {
    return latestImportedDevice;
  }

  return profileDatabase.db.prepare(`
    SELECT d.*
    FROM nights n
    JOIN devices d ON d.id = n.device_id
    ORDER BY n.night_date DESC, n.created_at DESC
    LIMIT 1
  `).get();
}

async function ensureSessionLoader() {
  if (dataLoader) {
    return dataLoader;
  }

  if (!currentDataPath || !fs.existsSync(currentDataPath)) {
    return null;
  }

  const loader = new CPAPDataLoader(currentDataPath);
  await loader.loadSessionList();
  dataLoader = loader;
  return dataLoader;
}

async function hydrateSummaryFromDatabase(profileDatabase = currentProfileDatabase) {
  if (!profileDatabase) {
    return null;
  }

  currentDataPath = getLatestImportedPath(profileDatabase);
  const device = getLatestDevice(profileDatabase);
  if (!device) {
    currentSummary = null;
    dataLoader = null;
    return null;
  }

  const sessionLoader = await ensureSessionLoader();
  const rows = profileDatabase.db.prepare(`
    SELECT
      n.night_date AS date,
      COALESCE(m.ahi_total, 0) AS ahi,
      COALESCE(m.apneas_per_hr, 0) AS ai,
      COALESCE(m.hypopneas_per_hr, 0) AS hi,
      COALESCE(m.obstructive_apneas_per_hr, 0) AS oai,
      COALESCE(m.central_apneas_per_hr, 0) AS cai,
      COALESCE(m.unclassified_apneas_per_hr, 0) AS uai,
      COALESCE(m.duration_minutes, n.usage_hours * 60, 0) AS duration,
      COALESCE(m.on_duration_minutes, n.usage_hours * 60, 0) AS onDuration,
      COALESCE(n.usage_hours, 0) AS usageHours,
      COALESCE(m.patient_hours_cumulative, 0) AS patientHoursCumulative,
      COALESCE(m.leak_p50, 0) AS leak50,
      COALESCE(m.leak_p95, 0) AS leak95,
      COALESCE(m.pressure_median, 0) AS pressure,
      COALESCE(m.pressure_p95, m.pressure_median, 0) AS maxPressure,
      COALESCE(m.minute_vent_p50, 0) AS minVent50,
      COALESCE(m.minute_vent_p95, 0) AS minVent95,
      COALESCE(m.tidal_vol_p50, 0) AS tidVol50,
      COALESCE(m.tidal_vol_p95, 0) AS tidVol95,
      COALESCE(m.resp_rate_p50, 0) AS respRate50,
      COALESCE(m.spo2_avg, 0) AS spo2Avg,
      COALESCE(m.pulse_avg, 0) AS pulseAvg,
      d.stability_score,
      d.therapy_stability_score,
      d.mask_fit_score,
      d.leak_severity_tier,
      d.leak_consistency_index,
      d.pressure_variance,
      d.flow_limitation_score,
      d.event_cluster_index,
      m.data_quality
    FROM nights n
    LEFT JOIN night_metrics m ON m.night_id = n.id
    LEFT JOIN derived_metrics d ON d.night_id = n.id
    WHERE n.device_id = ?
    ORDER BY n.night_date ASC
  `).all(device.id);

  const dailyStats = rows.map((row) => ({
    date: row.date,
    ahi: row.ahi,
    ai: row.ai,
    hi: row.hi,
    oai: row.oai,
    cai: row.cai,
    uai: row.uai,
    duration: row.duration,
    onDuration: row.onDuration,
    usageHours: row.usageHours,
    patientHoursCumulative: row.patientHoursCumulative,
    leak50: row.leak50,
    leak95: row.leak95,
    pressure: row.pressure,
    maxPressure: row.maxPressure,
    minVent50: row.minVent50,
    minVent95: row.minVent95,
    tidVol50: row.tidVol50,
    tidVol95: row.tidVol95,
    respRate50: row.respRate50,
    spo2Avg: row.spo2Avg,
    pulseAvg: row.pulseAvg,
    stability_score: row.stability_score,
    therapy_stability_score: row.therapy_stability_score,
    mask_fit_score: row.mask_fit_score,
    leak_severity_tier: row.leak_severity_tier,
    leak_consistency_index: row.leak_consistency_index,
    pressure_variance: row.pressure_variance,
    flow_limitation_score: row.flow_limitation_score,
    event_cluster_index: row.event_cluster_index,
    raw: {
      dataQuality: parseJsonSafely(row.data_quality),
      pressure_median: row.pressure
    }
  }));

  const recentDays = dailyStats.slice(-30);
  const calcAvg = (field) => {
    if (recentDays.length === 0) return 0;
    return recentDays.reduce((sum, day) => sum + (day[field] || 0), 0) / recentDays.length;
  };

  currentSummary = {
    deviceInfo: {
      serialNumber: device.serial_number || "Unknown",
      productName: device.model || "Unknown",
      model: device.model || "Unknown",
      manufacturer: device.manufacturer || "Unknown",
      machineId: device.id,
      firmwareVersion: device.firmware || "Unknown"
    },
    totalDays: dailyStats.length,
    recentDays: recentDays.length,
    averages: {
      ahi: calcAvg("ahi"),
      usage: calcAvg("usageHours"),
      pressure: calcAvg("maxPressure"),
      leak: calcAvg("leak95"),
      flowRate: calcAvg("minVent95"),
      tidalVolume: calcAvg("tidVol95")
    },
    dailyStats,
    sessions: sessionLoader ? sessionLoader.sessions.slice(0, 50) : []
  };

  if (!sessionLoader) {
    dataLoader = null;
  }

  return currentSummary;
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
    if (!summary || summary.error) {
      return { success: false, error: summary?.error || "No active profile selected." };
    }
    return { success: true, path: selectedPath, summary };
  });

  ipcMain.handle("cpap:load-data-folder", async (_event, folderPath) => {
    if (!folderPath || !fs.existsSync(path.join(folderPath, "STR.edf"))) {
      return { success: false, error: "Invalid CPAP folder path" };
    }
    const summary = await loadDataFromPath(folderPath);
    if (!summary || summary.error) {
      return { success: false, error: summary?.error || "No active profile selected." };
    }
    return { success: true, summary };
  });

  ipcMain.handle("cpap:get-summary", async () => {
    if (!currentSummary && currentProfileDatabase) {
      return hydrateSummaryFromDatabase();
    }
    return currentSummary;
  });

  ipcMain.handle("cpap:get-daily-stats", async () => {
    if (!dataLoader) {
      return currentSummary?.dailyStats || [];
    }
    return dataLoader.getDailyStats();
  });

  ipcMain.handle("cpap:get-session-detail", async (_event, sessionId) => {
    if (!dataLoader) {
      await ensureSessionLoader();
    }
    if (!dataLoader) {
      return { error: "Session detail requires access to the original import folder." };
    }
    return dataLoader.loadSessionDetail(sessionId);
  });

  ipcMain.handle("cpap:refresh", async () => {
    if (!currentDataPath && currentProfileDatabase) {
      currentDataPath = getLatestImportedPath(currentProfileDatabase);
    }
    if (!currentDataPath) {
      return { success: false, error: "No data path configured" };
    }
    const summary = await loadDataFromPath(currentDataPath);
    if (!summary || summary.error) {
      return { success: false, error: summary?.error || "Refresh failed" };
    }
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

      reportData.report = {
        ...(reportData.report || {}),
        pageCount: reportData?.report?.pageCount || 2,
        footerPage1: reportData?.report?.footerPage1 || "Page 1 of 2",
        footerPage2: reportData?.report?.footerPage2 || "Page 2 of 2"
      };

      if (currentProfileDatabase && reportData && reportData.device) {
        const db = currentProfileDatabase.db;
        const deviceId = db.prepare('SELECT id FROM devices WHERE serial_number = ?').get(reportData.device.serialNumber)?.id;

        if (deviceId) {
          const logoPath = resolveAssetPath(path.join("src", "renderer", "assets", "PLReportLogo.png"));
          let logoDataUri = "";
          try {
            const logoBuffer = fs.readFileSync(logoPath);
            logoDataUri = `data:image/png;base64,${logoBuffer.toString("base64")}`;
          } catch (err) {
            console.error("PLReportLogo.png not found", err);
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
              WHERE n.device_id = ? AND n.usage_hours > 0 AND n.night_date >= ? AND n.night_date <= ?
              ORDER BY n.night_date DESC
            `).all(deviceId, reportData.report.startDate, reportData.report.endDate);
          } else {
            const limit = reportData.report.rangeLabel === "All Time" ? 9999 : windowDays;
            nights = db.prepare(`
              SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage, m.pressure_median AS pressure, m.leak_p50 AS leak, m.minute_vent_p50 AS mv, m.resp_rate_p50 AS rr, m.tidal_vol_p50 AS tv
              FROM nights n
              JOIN night_metrics m ON m.night_id = n.id
              WHERE n.device_id = ? AND n.usage_hours > 0
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

          // Frontend payload builder now supplies reportData.summaryScores and reportData.correlations
          // The handler simply acts as a passthrough to the Handlebars compilation step.

          const defaultLogoPath = resolveAssetPath(path.join("src", "renderer", "assets", "PLReportLogo.png"));
          if (fs.existsSync(defaultLogoPath)) {
            const logof = fs.readFileSync(defaultLogoPath);
            reportData.brand = { logoDataUri: "data:image/png;base64," + logof.toString('base64') };
          }
        }
      }

      const compiledHtml = template(reportData || {});
      const tempHtmlPath = path.join(app.getPath("temp"), `paplens-report-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
      fs.writeFileSync(tempHtmlPath, compiledHtml, "utf8");

      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });

      try {
        await printWin.loadFile(tempHtmlPath);

        const pdfData = await printWin.webContents.printToPDF({
          printBackground: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          pageSize: "A4",
        });

        fs.writeFileSync(filePath, pdfData);
      } finally {
        if (!printWin.isDestroyed()) {
          printWin.close();
        }
        if (fs.existsSync(tempHtmlPath)) {
          fs.unlinkSync(tempHtmlPath);
        }
      }
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
    return currentDataPath || getLatestImportedPath(currentProfileDatabase) || secureSettings.getDecrypted("lastDataPath");
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
      WHERE n.device_id = ? AND n.usage_hours > 0
      ORDER BY n.night_date DESC
      LIMIT 1
    `).get(device.id);


    if (!lastNight) return null;

    const last7 = currentProfileDatabase.db.prepare(`
      SELECT n.night_date AS date, m.ahi_total AS ahi
      FROM nights n
      JOIN night_metrics m ON m.night_id = n.id
      WHERE n.device_id = ? AND n.usage_hours > 0
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
        WHERE n.device_id = ? AND n.usage_hours > 0 AND n.night_date BETWEEN ? AND ?
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
        WHERE n.device_id = ? AND n.usage_hours > 0
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
        SELECT id FROM nights WHERE device_id = ? AND usage_hours > 0 ORDER BY night_date DESC LIMIT 7
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

  ipcMain.handle("app:delete-profile", async (_event, profileId) => {
    try {
      if (profileId === activeProfileId) {
        if (currentProfileDatabase) {
          currentProfileDatabase.close();
          currentProfileDatabase = null;
        }
        activeProfileId = null;
        currentSummary = null;
        currentDataPath = null;
        dataLoader = null;
        secureSettings.setEncrypted("activeProfileId", "");
      }

      const profilePath = path.join(app.getPath("userData"), "data", "profiles", profileId);
      if (fs.existsSync(profilePath)) {
        fs.rmSync(profilePath, { recursive: true, force: true });
      }

      appDatabase.deleteProfile(profileId);
      return { success: true };
    } catch (error) {
      console.error("Failed to delete profile", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("app:set-active-profile", async (_event, profileId) => {
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
      await hydrateSummaryFromDatabase(currentProfileDatabase);
    } else {
      activeProfileId = null;
      secureSettings.setEncrypted("activeProfileId", "");
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
    await hydrateSummaryFromDatabase(currentProfileDatabase);
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




