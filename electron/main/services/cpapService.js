const fs = require("fs");
const { IncrementalImporter } = require("./incremental-import");
const { AnalyticsOrchestrator } = require("../analytics/orchestrator");
const { CPAPDataLoader } = require("./cpap-data-loader");
const { buildLeakAndTidalSummary, toOptionalNumber } = require("./therapyMetrics");

function parseJsonSafely(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
}

class CpapService {
    constructor(appContainer) {
        this.appContainer = appContainer;
        this.currentDataPath = null;
        this.dataLoader = null;
        this.currentSummary = null;
    }

    get profileDatabase() {
        return this.appContainer.get("profileDatabase");
    }

    get mainWindow() {
        return this.appContainer.get("windowManager").getMainWindow();
    }

    mergeDerivedMetricsIntoSummary(deviceId, summary) {
        if (!deviceId || !summary?.dailyStats) {
            return summary;
        }

        const dbStats = this.profileDatabase.db.prepare(`
        SELECT n.night_date,
               d.stability_score,
               d.therapy_stability_score,
               d.mask_fit_score,
               d.compliance_risk,
               d.leak_severity_tier,
               d.leak_consistency_index,
               d.pressure_variance,
               d.flow_limitation_score,
               d.event_cluster_index,
               d.outliers
        FROM nights n
        JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ?
      `).all(deviceId);

        const scoreMap = new Map(dbStats.map((row) => [row.night_date, row]));
        summary.dailyStats.forEach((day) => {
            const derived = scoreMap.get(day.date);
            if (!derived) {
                return;
            }

            day.stability_score = derived.stability_score;
            day.therapy_stability_score = derived.therapy_stability_score;
            day.mask_fit_score = derived.mask_fit_score;
            day.compliance_risk = derived.compliance_risk;
            day.leak_severity_tier = derived.leak_severity_tier;
            day.leak_consistency_index = derived.leak_consistency_index;
            day.pressure_variance = derived.pressure_variance;
            day.flow_limitation_score = derived.flow_limitation_score;
            day.event_cluster_index = derived.event_cluster_index;
            day.outliers = parseJsonSafely(derived.outliers);
        });

        return summary;
    }

    async loadDataFromPath(dataPath) {
        if (!this.profileDatabase) {
            console.warn("Attempted to load data without active profile database.");
            return null;
        }
        const importer = new IncrementalImporter(this.profileDatabase.db, dataPath);
        const result = await importer.runImport();
        if (!result.success) return { error: result.error };

        const summary = result.summary;
        this.currentSummary = summary;
        this.currentDataPath = dataPath;
        this.dataLoader = importer.loader;

        if (result.deviceId) {
            const missingNights = this.profileDatabase.db.prepare(`
        SELECT n.night_date 
        FROM nights n
        LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 AND (d.night_id IS NULL OR d.therapy_stability_score IS NULL)
        ORDER BY n.night_date DESC LIMIT 90
      `).all(result.deviceId).map(r => r.night_date);

            const nightsToRun = new Set([...result.runAnalyticsOn, ...missingNights]);
            if (nightsToRun.size > 0) {
                const orchestrator = new AnalyticsOrchestrator(this.profileDatabase.db);
                await orchestrator.runForNights(result.deviceId, Array.from(nightsToRun));
            }

            this.mergeDerivedMetricsIntoSummary(result.deviceId, summary);
        }

        if (this.mainWindow) {
            this.mainWindow.webContents.send("cpap:data-loaded", summary);
        }
        return summary;
    }

    getLatestImportedPath() {
        if (!this.profileDatabase) return null;
        const row = this.profileDatabase.db.prepare(`
      SELECT folder_path FROM import_log
      WHERE folder_path IS NOT NULL AND folder_path != ''
      ORDER BY import_timestamp DESC LIMIT 1
    `).get();
        return row?.folder_path || null;
    }

    getLatestDevice() {
        if (!this.profileDatabase) return null;
        const latestImportedDevice = this.profileDatabase.db.prepare(`
      SELECT d.* FROM import_log i
      JOIN devices d ON d.id = i.device_id
      WHERE i.device_id IS NOT NULL
      ORDER BY i.import_timestamp DESC LIMIT 1
    `).get();
        if (latestImportedDevice) return latestImportedDevice;

        return this.profileDatabase.db.prepare(`
      SELECT d.* FROM nights n
      JOIN devices d ON d.id = n.device_id
      ORDER BY n.night_date DESC, n.created_at DESC LIMIT 1
    `).get();
    }

    async ensureSessionLoader() {
        if (this.dataLoader) return this.dataLoader;
        if (!this.currentDataPath || !fs.existsSync(this.currentDataPath)) return null;

        const loader = new CPAPDataLoader(this.currentDataPath);
        await loader.loadSessionList();
        this.dataLoader = loader;
        return this.dataLoader;
    }

    async hydrateSummaryFromDatabase() {
        if (!this.profileDatabase) return null;

        this.currentDataPath = this.getLatestImportedPath();
        const device = this.getLatestDevice();
        if (!device) {
            this.currentSummary = null;
            this.dataLoader = null;
            return null;
        }

        const sessionLoader = await this.ensureSessionLoader();
        const recentNightsForAnalytics = this.profileDatabase.db.prepare(`
      SELECT night_date
      FROM nights
      WHERE device_id = ? AND usage_hours > 0
      ORDER BY night_date DESC
      LIMIT 90
    `).all(device.id).map((row) => row.night_date);

        if (recentNightsForAnalytics.length > 0) {
            const orchestrator = new AnalyticsOrchestrator(this.profileDatabase.db);
            await orchestrator.runForNights(device.id, recentNightsForAnalytics);
        }

        const rows = this.profileDatabase.db.prepare(`
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
        m.leak_p50 AS leak50,
        m.leak_p95 AS leak95,
        m.pressure_median AS pressure,
        COALESCE(m.pressure_p95, m.pressure_median) AS maxPressure,
        m.minute_vent_p50 AS minVent50,
        m.minute_vent_p95 AS minVent95,
        m.tidal_vol_p50 AS tidVol50,
        m.tidal_vol_p95 AS tidVol95,
        m.resp_rate_p50 AS respRate50,
        m.spo2_avg AS spo2Avg,
        m.pulse_avg AS pulseAvg,
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
            ahi: row.ahi, ai: row.ai, hi: row.hi, oai: row.oai, cai: row.cai, uai: row.uai,
            duration: row.duration, onDuration: row.onDuration, usageHours: row.usageHours, patientHoursCumulative: row.patientHoursCumulative,
            leak50: row.leak50, leak95: row.leak95, pressure: row.pressure, maxPressure: row.maxPressure,
            minVent50: row.minVent50, minVent95: row.minVent95, tidVol50: row.tidVol50, tidVol95: row.tidVol95,
            respRate50: row.respRate50, spo2Avg: row.spo2Avg, pulseAvg: row.pulseAvg,
            stability_score: row.stability_score, therapy_stability_score: row.therapy_stability_score,
            mask_fit_score: row.mask_fit_score, leak_severity_tier: row.leak_severity_tier, leak_consistency_index: row.leak_consistency_index,
            pressure_variance: row.pressure_variance, flow_limitation_score: row.flow_limitation_score, event_cluster_index: row.event_cluster_index,
            raw: { dataQuality: parseJsonSafely(row.data_quality), pressure_median: row.pressure }
        }));

        const recentDays = dailyStats.slice(-30);
        const calcAvg = (field) => {
            const values = recentDays
                .map((day) => toOptionalNumber(day[field]))
                .filter((value) => value !== null);

            if (values.length === 0) return null;
            return values.reduce((sum, value) => sum + value, 0) / values.length;
        };
        const metricSummary = buildLeakAndTidalSummary(recentDays, console, "analytics:hydrate");

        this.currentSummary = {
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
                ahi: calcAvg("ahi"), usage: calcAvg("usageHours"), pressure: calcAvg("maxPressure"),
                leak: metricSummary.leak, flowRate: calcAvg("minVent95"), tidalVolume: metricSummary.tidalVolume
            },
            metricSummary,
            dailyStats,
            sessions: sessionLoader ? sessionLoader.sessions.slice(0, 50) : []
        };

        if (!sessionLoader) this.dataLoader = null;
        return this.currentSummary;
    }
}

module.exports = { CpapService };
