const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { IncrementalImporter } = require("./incremental-import");
const { AnalyticsOrchestrator } = require("../analytics/orchestrator");
const { CPAPDataLoader } = require("./cpap-data-loader");
const { detectDataFolder } = require("../loaders/loader-registry");
const { buildLeakAndTidalSummary, toOptionalNumber } = require("./therapyMetrics");
const { CLINICAL_SIGNIFICANCE_PCT } = require("../analytics/periodicBreathing");

/**
 * Bump when stored values (not schema) need a one-time correction. Tracked in
 * the profile DB's `user_version` pragma so each profile migrates exactly once.
 */
const PROFILE_DATA_VERSION = 2;

function parseJsonSafely(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function measureSummaryPayload(summary, logger = console) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(summary), "utf8");
    const dailyCount = Array.isArray(summary?.dailyStats) ? summary.dailyStats.length : 0;
    const sessionCount = Array.isArray(summary?.sessions) ? summary.sessions.length : 0;
    const mb = bytes / (1024 * 1024);
    const message = `[ipc] cpap:data-loaded payload=${bytes} bytes (${mb.toFixed(2)} MiB), dailyStats=${dailyCount}, sessions=${sessionCount}`;
    if (bytes > 1024 * 1024) {
      logger.warn(`${message}; consider staged dailyStats fetch if this is representative.`);
    } else {
      logger.info(message);
    }
    return bytes;
  } catch (error) {
    logger.warn(`[ipc] Failed to measure cpap:data-loaded payload: ${error.message}`);
    return null;
  }
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

    const dbStats = this.profileDatabase.db
      .prepare(
        `
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
      `
      )
      .all(deviceId);

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

  attachImportMetadata(summary) {
    if (!summary || !this.profileDatabase) return summary;

    const row = this.profileDatabase.db
      .prepare(
        `
      SELECT import_timestamp FROM import_log
      ORDER BY import_timestamp DESC LIMIT 1
    `
      )
      .get();

    summary.lastImportedAt = row?.import_timestamp || null;
    return summary;
  }

  async loadDataFromPath(dataPath) {
    if (!this.profileDatabase) {
      console.warn("Attempted to load data without active profile database.");
      return null;
    }
    const importer = new IncrementalImporter(this.profileDatabase.db, dataPath);
    const onProgress = (progress) => {
      this.mainWindow?.webContents.send("cpap:import-progress", progress);
    };
    const result = await importer.runImport(onProgress);
    if (!result.success) return { error: result.error };

    const summary = result.summary;
    this.currentSummary = summary;
    this.currentDataPath = dataPath;
    this.dataLoader = importer.loader;

    if (result.deviceId) {
      const missingNights = this.profileDatabase.db
        .prepare(
          `
        SELECT n.night_date 
        FROM nights n
        LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 AND (d.night_id IS NULL OR d.therapy_stability_score IS NULL)
        ORDER BY n.night_date DESC LIMIT 90
      `
        )
        .all(result.deviceId)
        .map((r) => r.night_date);

      const nightsToRun = new Set([...result.runAnalyticsOn, ...missingNights]);
      if (nightsToRun.size > 0) {
        const orchestrator = new AnalyticsOrchestrator(this.profileDatabase.db);
        await orchestrator.runForNights(result.deviceId, Array.from(nightsToRun));
      }

      this.mergeDerivedMetricsIntoSummary(result.deviceId, summary);
    }
    this.attachImportMetadata(summary);

    if (this.mainWindow) {
      measureSummaryPayload(summary);
      this.mainWindow.webContents.send("cpap:data-loaded", summary);
    }

    // Sync EDF files to profile-local cache so session graphs survive SD-card removal.
    if (this.profileDatabase?.profilePath) {
      const cacheDir = path.join(this.profileDatabase.profilePath, "session-cache");
      setImmediate(() => {
        this._syncSessionCache(dataPath, cacheDir).catch((err) =>
          console.warn("[cache] Session cache sync failed:", err)
        );
      });
    }

    return summary;
  }

  getLatestImportedPath() {
    if (!this.profileDatabase) return null;
    const row = this.profileDatabase.db
      .prepare(
        `
      SELECT folder_path FROM import_log
      WHERE folder_path IS NOT NULL AND folder_path != ''
      ORDER BY import_timestamp DESC LIMIT 1
    `
      )
      .get();
    return row?.folder_path || null;
  }

  getLatestDevice() {
    if (!this.profileDatabase) return null;
    const latestImportedDevice = this.profileDatabase.db
      .prepare(
        `
      SELECT d.* FROM import_log i
      JOIN devices d ON d.id = i.device_id
      WHERE i.device_id IS NOT NULL
      ORDER BY i.import_timestamp DESC LIMIT 1
    `
      )
      .get();
    if (latestImportedDevice) return latestImportedDevice;

    return this.profileDatabase.db
      .prepare(
        `
      SELECT d.* FROM nights n
      JOIN devices d ON d.id = n.device_id
      ORDER BY n.night_date DESC, n.created_at DESC LIMIT 1
    `
      )
      .get();
  }

  async ensureSessionLoader() {
    if (this.dataLoader) return this.dataLoader;
    if (!this.currentDataPath || !fs.existsSync(this.currentDataPath)) return null;

    // Session waveform loading is ResMed/EDF-only; require STR.edf before proceeding.
    if (!fs.existsSync(path.join(this.currentDataPath, "STR.edf"))) return null;

    const loader = new CPAPDataLoader(this.currentDataPath);
    await loader.loadSessionList();
    this.dataLoader = loader;
    return this.dataLoader;
  }

  async reattachSessionFolder(folderPath) {
    if (!detectDataFolder(folderPath)) {
      return { success: false, error: "No supported CPAP data found. Please select your CPAP data folder." };
    }
    // Session waveform viewing is only available for ResMed (EDF-based) devices.
    // For other manufacturers, reattach succeeds but session list will be empty.
    const strPath = path.join(folderPath, "STR.edf");
    if (fs.existsSync(strPath)) {
      const loader = new CPAPDataLoader(folderPath);
      await loader.loadSessionList();
      this.dataLoader = loader;
      this.currentDataPath = folderPath;
      return { success: true, sessionCount: loader.sessions.length };
    }
    this.currentDataPath = folderPath;
    return { success: true, sessionCount: 0 };
  }

  // Incrementally copies STR.edf, Identification files, and DATALOG session folders
  // from sourcePath into cachePath. Already-cached date folders are skipped so
  // repeat imports after the first are nearly instant.
  async _syncSessionCache(sourcePath, cachePath) {
    await fsPromises.mkdir(cachePath, { recursive: true });

    // Always refresh STR.edf — it grows with each new night.
    const strSrc = path.join(sourcePath, "STR.edf");
    if (fs.existsSync(strSrc)) {
      await fsPromises.copyFile(strSrc, path.join(cachePath, "STR.edf"));
    }

    // Identification files are static — copy once.
    for (const idFile of ["Identification.json", "Identification.tgt"]) {
      const src = path.join(sourcePath, idFile);
      const dst = path.join(cachePath, idFile);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        await fsPromises.copyFile(src, dst);
      }
    }

    // DATALOG: copy only date directories not already in the cache.
    const srcDatalog = path.join(sourcePath, "DATALOG");
    const dstDatalog = path.join(cachePath, "DATALOG");
    if (!fs.existsSync(srcDatalog)) return;
    await fsPromises.mkdir(dstDatalog, { recursive: true });

    const dateDirs = await fsPromises.readdir(srcDatalog);
    for (const dateDir of dateDirs) {
      if (!/^\d{8}$/.test(dateDir)) continue;
      const dstDate = path.join(dstDatalog, dateDir);
      if (fs.existsSync(dstDate)) continue; // already cached

      await fsPromises.mkdir(dstDate, { recursive: true });
      const files = await fsPromises.readdir(path.join(srcDatalog, dateDir));
      for (const file of files) {
        if (!file.endsWith(".edf")) continue;
        await fsPromises.copyFile(path.join(srcDatalog, dateDir, file), path.join(dstDate, file));
      }
    }
    console.info(`[cache] Session cache synced → ${cachePath}`);
  }

  /**
   * One-time corrections to values already written to a profile database.
   * Runs before the normal startup analytics pass so that pass sees corrected
   * inputs. Gated on the `user_version` pragma, so it is a no-op on every
   * launch after the first.
   *
   * v1 fixes two stored values that were decided on numbers the user never saw:
   *   - `pb_is_significant` was tested against the *unrounded* PB percentage
   *     but stored next to the rounded one, so a 4.96% night persisted as
   *     "5.0%, not significant". Recomputing it from the stored (rounded)
   *     pb_pct reproduces exactly what the corrected detector now emits, so
   *     this needs no EDF re-parse.
   *   - `insights_explanations` holds pre-rendered sentences; their wording and
   *     scope changed, so every night's narrative is regenerated. Regenerating
   *     (rather than deleting) keeps findings for nights older than the 90-night
   *     window the routine startup pass looks at.
   *
   * v2 backfills `derived_metrics.mask_fit_score`, which the orchestrator wrote
   * as a hardcoded null, leaving the mask-fit finding unable to fire. The
   * regeneration pass below recomputes it from leak metrics already on disk, so
   * this also needs no EDF re-parse.
   */
  async applyPendingDataMigrations() {
    const db = this.profileDatabase.db;
    const current = db.pragma("user_version", { simple: true }) || 0;
    if (current >= PROFILE_DATA_VERSION) return false;

    console.info(`[migrate] profile data v${current} → v${PROFILE_DATA_VERSION}`);

    const realigned = db
      .prepare(
        `UPDATE night_metrics
                 SET pb_is_significant = CASE WHEN pb_pct >= ? THEN 1 ELSE 0 END
                 WHERE pb_pct IS NOT NULL`
      )
      .run(CLINICAL_SIGNIFICANCE_PCT);
    console.info(`[migrate] realigned pb_is_significant on ${realigned.changes} nights`);

    // Every device in the profile, not just the latest — a one-time pass
    // should not leave an older device's findings stale.
    const devices = db.prepare(`SELECT id FROM devices`).all();
    for (const device of devices) {
      const nightDates = db
        .prepare(
          `SELECT night_date FROM nights
                     WHERE device_id = ? AND usage_hours > 0
                     ORDER BY night_date DESC`
        )
        .all(device.id)
        .map((row) => row.night_date);
      if (nightDates.length === 0) continue;
      const orchestrator = new AnalyticsOrchestrator(db);
      await orchestrator.runForNights(device.id, nightDates);
      console.info(`[migrate] regenerated findings for ${nightDates.length} nights on device ${device.id}`);
    }

    db.pragma(`user_version = ${PROFILE_DATA_VERSION}`);
    return true;
  }

  async hydrateSummaryFromDatabase() {
    if (!this.profileDatabase) return null;

    try {
      await this.applyPendingDataMigrations();
    } catch (err) {
      // A failed backfill must not block startup. The version pragma is only
      // bumped on success, so a throwing failure retries next launch.
      // (runForNights logs and swallows its own errors, so a regeneration
      // failure leaves the old wording in place rather than retrying.)
      console.error("[migrate] profile data migration failed:", err);
    }

    // Prefer the local session cache (populated during import) so that session
    // graphs work even when the original SD card is no longer mounted.
    const cacheDir = path.join(this.profileDatabase.profilePath, "session-cache");
    const cacheHasDatalog = fs.existsSync(path.join(cacheDir, "DATALOG"));
    this.currentDataPath = cacheHasDatalog ? cacheDir : this.getLatestImportedPath();
    const device = this.getLatestDevice();
    if (!device) {
      this.currentSummary = null;
      this.dataLoader = null;
      return null;
    }

    const sessionLoader = await this.ensureSessionLoader();
    // Only run analytics for nights that are genuinely missing scores.
    // Re-running all 90 nights on every startup was the primary cause of
    // slow app launch even when no new data had been imported.
    const recentNightsForAnalytics = this.profileDatabase.db
      .prepare(
        `
      SELECT n.night_date
      FROM nights n
      LEFT JOIN derived_metrics d ON d.night_id = n.id
      WHERE n.device_id = ? AND n.usage_hours > 0
        AND (d.night_id IS NULL OR d.therapy_stability_score IS NULL)
      ORDER BY n.night_date DESC
      LIMIT 90
    `
      )
      .all(device.id)
      .map((row) => row.night_date);

    if (recentNightsForAnalytics.length > 0) {
      const orchestrator = new AnalyticsOrchestrator(this.profileDatabase.db);
      await orchestrator.runForNights(device.id, recentNightsForAnalytics);
    }

    const rows = this.profileDatabase.db
      .prepare(
        `
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
        m.pb_pct AS pbPct,
        m.sample_counts AS sampleCountsJson,
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
    `
      )
      .all(device.id);

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
      pbPct: row.pbPct,
      sampleCounts: parseJsonSafely(row.sampleCountsJson),
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
        sampleCounts: parseJsonSafely(row.sampleCountsJson),
        pressure_median: row.pressure
      }
    }));

    const recentDays = dailyStats.slice(-30);
    const calcAvg = (field) => {
      const values = recentDays.map((day) => toOptionalNumber(day[field])).filter((value) => value !== null);

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
      deviceCapabilities: {
        supportsOximetry: false
      },
      totalDays: dailyStats.length,
      recentDays: recentDays.length,
      averages: {
        ahi: calcAvg("ahi"),
        usage: calcAvg("usageHours"),
        pressure: calcAvg("maxPressure"),
        leak: metricSummary.leak,
        flowRate: calcAvg("minVent95"),
        tidalVolume: metricSummary.tidalVolume
      },
      metricSummary,
      dailyStats,
      sessions: sessionLoader ? sessionLoader.sessions : []
    };
    this.attachImportMetadata(this.currentSummary);

    if (!sessionLoader) this.dataLoader = null;
    return this.currentSummary;
  }
}

module.exports = { CpapService, measureSummaryPayload };
