const { ipcMain, dialog, app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const { resolveHost, probeTcp, getNodeVersionFromChildProcess } = require("./diagnostics");
const { ProfileDatabase } = require("./database");
const { buildLeakAndTidalSummary, toOptionalNumber } = require("./therapyMetrics");
const { computeTherapyStabilityScore } = require("../analytics/scores");

class IpcRouter {
    constructor(appContainer) {
        this.appContainer = appContainer;
    }

    get cpap() { return this.appContainer.get("cpapService"); }
    get profileDb() { return this.appContainer.get("profileDatabase"); }
    get appDb() { return this.appContainer.get("appDatabase"); }
    get secureSettings() { return this.appContainer.get("secureSettings"); }
    get windowManager() { return this.appContainer.get("windowManager"); }

    resolveAssetPath(relativePath) {
        return this.windowManager.resolveAssetPath(relativePath);
    }

    register() {
        ipcMain.handle("cpap:select-data-folder", async () => {
            const mainWindow = this.windowManager.getMainWindow();
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
            const summary = await this.cpap.loadDataFromPath(selectedPath);
            if (!summary || summary.error) {
                return { success: false, error: summary?.error || "No active profile selected." };
            }
            return { success: true, path: selectedPath, summary };
        });

        ipcMain.handle("cpap:load-data-folder", async (_event, folderPath) => {
            if (!folderPath || !fs.existsSync(path.join(folderPath, "STR.edf"))) {
                return { success: false, error: "Invalid CPAP folder path" };
            }
            const summary = await this.cpap.loadDataFromPath(folderPath);
            if (!summary || summary.error) {
                return { success: false, error: summary?.error || "No active profile selected." };
            }
            return { success: true, summary };
        });

        ipcMain.handle("cpap:get-summary", async () => {
            if (!this.cpap.currentSummary && this.profileDb) {
                return await this.cpap.hydrateSummaryFromDatabase();
            }
            return this.cpap.currentSummary;
        });

        ipcMain.handle("cpap:get-daily-stats", async () => {
            if (!this.cpap.dataLoader) return this.cpap.currentSummary?.dailyStats || [];
            return this.cpap.dataLoader.getDailyStats();
        });

        ipcMain.handle("cpap:get-session-detail", async (_event, sessionId) => {
            if (!this.cpap.dataLoader) await this.cpap.ensureSessionLoader();
            if (!this.cpap.dataLoader) return { error: "Session detail requires original folder." };
            return this.cpap.dataLoader.loadSessionDetail(sessionId);
        });

        ipcMain.handle("cpap:refresh", async () => {
            if (!this.cpap.currentDataPath && this.profileDb) {
                this.cpap.currentDataPath = this.cpap.getLatestImportedPath();
            }
            if (!this.cpap.currentDataPath) return { success: false, error: "No data path configured" };
            const summary = await this.cpap.loadDataFromPath(this.cpap.currentDataPath);
            if (!summary || summary.error) return { success: false, error: summary?.error || "Refresh failed" };
            return { success: true, summary };
        });

        ipcMain.handle("cpap:save-report", async (_event, reportData) => {
            const mainWindow = this.windowManager.getMainWindow();
            if (!mainWindow) return { success: false, error: "No active window" };
            try {
                const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                    title: "Export Report as PDF",
                    defaultPath: "PAPLens_Report.pdf",
                    filters: [{ name: "PDF Files", extensions: ["pdf"] }]
                });
                if (canceled || !filePath) return { success: false, error: "Cancelled" };

                const isDev = !app.isPackaged;
                const templatePath = isDev ? path.join(__dirname, "..", "..", "..", "report.html") : path.join(process.resourcesPath, "app.asar", "report.html");
                const templateStr = fs.readFileSync(templatePath, "utf8");
                const template = Handlebars.compile(templateStr);

                reportData.report = {
                    ...(reportData.report || {}),
                    pageCount: reportData?.report?.pageCount || 2,
                    footerPage1: reportData?.report?.footerPage1 || "Page 1 of 2",
                    footerPage2: reportData?.report?.footerPage2 || "Page 2 of 2"
                };

                if (this.profileDb && reportData && reportData.device) {
                    const db = this.profileDb.db;
                    const deviceId = db.prepare('SELECT id FROM devices WHERE serial_number = ?').get(reportData.device.serialNumber)?.id;

                    if (deviceId) {
                        const logoPath = this.resolveAssetPath(path.join("src", "renderer", "assets", "PLReportLogo.png"));
                        let logoDataUri = "";
                        try {
                            logoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
                        } catch (err) { console.error("PLReportLogo.png not found", err); }
                        reportData.header = { logoUrl: logoDataUri };

                        const windowDays = reportData.report.windowDays || 30;
                        let nights;
                        if (reportData.report.startDate && reportData.report.endDate) {
                            nights = db.prepare(`
                SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage, m.pressure_median AS pressure, m.leak_p50 AS leak, m.minute_vent_p50 AS mv, m.resp_rate_p50 AS rr, m.tidal_vol_p50 AS tv
                FROM nights n JOIN night_metrics m ON m.night_id = n.id
                WHERE n.device_id = ? AND n.usage_hours > 0 AND n.night_date >= ? AND n.night_date <= ?
                ORDER BY n.night_date DESC
              `).all(deviceId, reportData.report.startDate, reportData.report.endDate);
                        } else {
                            const limit = reportData.report.rangeLabel === "All Time" ? 9999 : windowDays;
                            nights = db.prepare(`
                SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage, m.pressure_median AS pressure, m.leak_p50 AS leak, m.minute_vent_p50 AS mv, m.resp_rate_p50 AS rr, m.tidal_vol_p50 AS tv
                FROM nights n JOIN night_metrics m ON m.night_id = n.id
                WHERE n.device_id = ? AND n.usage_hours > 0
                ORDER BY n.night_date DESC LIMIT ?
              `).all(deviceId, limit);
                        }

                        reportData.tables = {
                            nights: nights.map(n => ({
                                date: n.date,
                                ahi: formatReportMetric(n.ahi, 1),
                                usage: formatReportMetric(n.usage, 1),
                                pressure: formatReportMetric(n.pressure, 1),
                                leak: formatReportMetric(n.leak, 1),
                                mv: formatReportMetric(n.mv, 1),
                                rr: formatReportMetric(n.rr, 1),
                                tv: formatReportMetric(n.tv, 1)
                            }))
                        };

                        const defaultLogoPath = this.resolveAssetPath(path.join("src", "renderer", "assets", "PLReportLogo.png"));
                        if (fs.existsSync(defaultLogoPath)) {
                            reportData.brand = { logoDataUri: "data:image/png;base64," + fs.readFileSync(defaultLogoPath).toString('base64') };
                        }
                    }
                }

                const compiledHtml = template(reportData || {});
                const tempHtmlPath = path.join(app.getPath("temp"), `paplens-report-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
                fs.writeFileSync(tempHtmlPath, compiledHtml, "utf8");

                const printWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
                try {
                    await printWin.loadFile(tempHtmlPath);
                    fs.writeFileSync(filePath, await printWin.webContents.printToPDF({
                        printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, pageSize: "A4",
                    }));
                } finally {
                    if (!printWin.isDestroyed()) printWin.close();
                    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath);
                }
                return { success: true, filePath };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        ipcMain.handle("cpap:set-time-filter", async (_event, dayStartHour, dayEndHour) => {
            if (!this.cpap.dataLoader) return { success: false, error: "No data loaded" };
            this.cpap.dataLoader.setDayBoundary(dayStartHour, dayEndHour);
            const summary = this.cpap.dataLoader.getSummary();
            this.cpap.currentSummary = summary;
            if (this.windowManager.getMainWindow()) {
                this.windowManager.getMainWindow().webContents.send("cpap:data-loaded", summary);
            }
            return { success: true, summary };
        });

        ipcMain.handle("app:get-last-data-path", async () => {
            return this.cpap.currentDataPath || this.cpap.getLatestImportedPath() || this.secureSettings.getDecrypted("lastDataPath");
        });

        ipcMain.handle("cpap:get-last-night-overview", async () => {
            if (!this.profileDb || !this.cpap.currentSummary?.deviceInfo?.serialNumber) return null;
            const serial = this.cpap.currentSummary.deviceInfo.serialNumber;
            const device = this.profileDb.db.prepare(`SELECT id FROM devices WHERE serial_number = ?`).get(serial);
            if (!device) return null;

            const lastNight = this.profileDb.db.prepare(`
        SELECT n.id AS night_id, n.night_date, m.ahi_total, m.pressure_median, m.pressure_p95, m.leak_p50, m.leak_p95,
               m.flow_limitation_p95, m.event_cluster_index_source, n.usage_hours,
               d.stability_score, d.therapy_stability_score, d.mask_fit_score, d.compliance_risk, d.outliers,
               d.pressure_variance, d.flow_limitation_score, d.event_cluster_index
        FROM nights n
        JOIN night_metrics m ON m.night_id = n.id
        LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0
        ORDER BY n.night_date DESC LIMIT 1
      `).get(device.id);

            if (!lastNight) return null;

            const last7 = this.profileDb.db.prepare(`
        SELECT n.night_date AS date, m.ahi_total AS ahi
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0
        ORDER BY n.night_date DESC LIMIT 7
      `).all(device.id).reverse();

            const history30 = this.profileDb.db.prepare(`
        SELECT n.usage_hours, m.ahi_total, m.leak_p50, m.leak_p95, m.pressure_median, m.pressure_p95,
               m.minute_vent_p50, m.minute_vent_p95, m.tidal_vol_p50, m.tidal_vol_p95, m.flow_limitation_p95
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.night_date < ? AND n.usage_hours > 0
        ORDER BY n.night_date DESC LIMIT 30
      `).all(device.id, lastNight.night_date);

            return { ...lastNight, last7, scoreDetails: computeTherapyStabilityScore(lastNight, history30) };
        });

        ipcMain.handle("cpap:get-insights", async (_event, payload) => {
            if (!this.profileDb || !this.cpap.currentSummary?.deviceInfo?.serialNumber) return null;
            const serial = this.cpap.currentSummary.deviceInfo.serialNumber;
            const device = this.profileDb.db.prepare(`SELECT id FROM devices WHERE serial_number = ?`).get(serial);
            if (!device) return null;

            const { days = 30, from = null, to = null } = payload || {};
            let trendRows;
            if (from && to) {
                trendRows = this.profileDb.db.prepare(`
          SELECT n.night_date, m.ahi_total, n.usage_hours, m.pressure_median, m.leak_p50, m.leak_p95,
                 m.minute_vent_p50, m.resp_rate_p50, m.tidal_vol_p50, d.residual_burden
          FROM nights n JOIN night_metrics m ON m.night_id = n.id
          LEFT JOIN derived_metrics d ON d.night_id = n.id
          WHERE n.device_id = ? AND n.usage_hours > 0 AND n.night_date BETWEEN ? AND ?
          ORDER BY n.night_date DESC
        `).all(device.id, from, to);
            } else {
                const limit = days === 0 ? 99999 : days;
                trendRows = this.profileDb.db.prepare(`
          SELECT n.night_date, m.ahi_total, n.usage_hours, m.pressure_median, m.leak_p50, m.leak_p95,
                 m.minute_vent_p50, m.resp_rate_p50, m.tidal_vol_p50, d.residual_burden
          FROM nights n JOIN night_metrics m ON m.night_id = n.id
          LEFT JOIN derived_metrics d ON d.night_id = n.id
          WHERE n.device_id = ? AND n.usage_hours > 0
          ORDER BY n.night_date DESC LIMIT ?
        `).all(device.id, limit);
            }

            const corrWindow = (days >= 30 || days === 0) ? 30 : 7;
            const latestCorrs = this.profileDb.db.prepare(`
        SELECT results FROM correlations WHERE device_id = ? AND window_days = ?
        ORDER BY computed_at DESC LIMIT 1
      `).get(device.id, corrWindow);

            const explanations = this.profileDb.db.prepare(`
        SELECT title, summary, details, key, night_id 
        FROM insights_explanations 
        WHERE night_id IN (
          SELECT id FROM nights WHERE device_id = ? AND usage_hours > 0 ORDER BY night_date DESC LIMIT 7
        ) ORDER BY created_at DESC LIMIT 10
      `).all(device.id);

            return {
                trends: trendRows,
                correlations: latestCorrs ? JSON.parse(latestCorrs.results) : [],
                explanations,
                metricSummary: buildLeakAndTidalSummary(trendRows, console, "analytics:insights")
            };
        });

        ipcMain.handle("app:get-profiles", () => { return this.appDb.getProfiles(); });
        ipcMain.handle("app:create-profile", (_event, { id, name, age, notes }) => {
            this.appDb.createProfile(id, name, age, notes); return { success: true };
        });
        ipcMain.handle("app:delete-profile", async (_event, profileId) => {
            try {
                if (profileId === this.appContainer.get("activeProfileId")) {
                    if (this.profileDb) { this.profileDb.close(); this.appContainer.register("profileDatabase", null); }
                    this.appContainer.register("activeProfileId", null);
                    this.cpap.currentSummary = null; this.cpap.currentDataPath = null; this.cpap.dataLoader = null;
                    this.secureSettings.setEncrypted("activeProfileId", "");
                }
                const profilePath = path.join(app.getPath("userData"), "data", "profiles", profileId);
                if (fs.existsSync(profilePath)) fs.rmSync(profilePath, { recursive: true, force: true });
                this.appDb.deleteProfile(profileId);
                return { success: true };
            } catch (error) { return { success: false, error: error.message }; }
        });
        ipcMain.handle("app:set-active-profile", async (_event, profileId) => {
            if (this.profileDb) this.profileDb.close();
            this.cpap.currentSummary = null; this.cpap.dataLoader = null; this.cpap.currentDataPath = null;
            if (profileId) {
                const pd = new ProfileDatabase(app.getPath("userData"), profileId);
                this.appContainer.register("profileDatabase", pd);
                this.appContainer.register("activeProfileId", profileId);
                this.secureSettings.setEncrypted("activeProfileId", profileId);
                await this.cpap.hydrateSummaryFromDatabase();
            } else {
                this.appContainer.register("profileDatabase", null);
                this.appContainer.register("activeProfileId", null);
                this.secureSettings.setEncrypted("activeProfileId", "");
            }
            return { success: true };
        });
        ipcMain.handle("app:get-active-profile", () => {
            const pId = this.appContainer.get("activeProfileId");
            return pId ? this.appDb.getProfile(pId) : null;
        });

        ipcMain.handle("diag:resolve-host", async (_event, hostname) => resolveHost(hostname));
        ipcMain.handle("diag:tcp-probe", async (_event, host, port, timeoutMs) => probeTcp(host, port, timeoutMs));
        ipcMain.handle("diag:node-version", async () => getNodeVersionFromChildProcess());
    }
}

function formatReportMetric(value, digits = 1) {
    const numeric = toOptionalNumber(value);
    return numeric === null ? "N/A" : numeric.toFixed(digits);
}

module.exports = { IpcRouter };
