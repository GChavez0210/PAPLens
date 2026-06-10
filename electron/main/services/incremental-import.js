const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getLoader } = require("../loaders/loader-registry");
const { formatDebugValue, safeInfo, toOptionalNumber } = require("./therapyMetrics");

class IncrementalImporter {
    constructor(db, dataPath) {
        this.db = db;
        this.dataPath = dataPath;
        this.loader = getLoader(dataPath);
    }

    async runImport(onProgress) {
        // Build the set of night dates whose session-derived metrics are already
        // fully stored AND whose DATALOG date folder has not changed since last import.
        // Both conditions must be true to safely skip EDF parsing.
        const cachedRows = this.db.prepare(`
            SELECT n.night_date,
                   m.leak_p50, m.leak_p95, m.tidal_vol_p50, m.tidal_vol_p95,
                   m.minute_vent_p50, m.minute_vent_p95, m.resp_rate_p50, m.resp_rate_p95,
                   m.flow_limitation_p95, m.spo2_avg, m.pulse_avg,
                   m.snore_index, m.leak_spike_count, m.pressure_histogram,
                   m.pressure_efficiency, m.event_cluster_index_source,
                   m.pb_episode_count, m.pb_total_seconds, m.pb_pct,
                   m.pb_avg_cycle_sec, m.pb_is_significant, m.pb_leak_confounded
            FROM nights n
            JOIN night_metrics m ON m.night_id = n.id
            WHERE m.leak_p95 IS NOT NULL
              AND m.tidal_vol_p50 IS NOT NULL
              AND m.flow_limitation_p95 IS NOT NULL
        `).all();

        // Load stored mtimes for this data folder
        const storedMtimes = new Map(
            this.db.prepare(`SELECT date_dir, mtime_ms FROM datalog_folder_mtimes WHERE folder_path = ?`)
                .all(this.dataPath)
                .map(r => [r.date_dir, r.mtime_ms])
        );

        // Check current mtimes for DATALOG date dirs
        const datalogPath = path.join(this.dataPath, "DATALOG");
        const currentMtimes = new Map();
        if (fs.existsSync(datalogPath)) {
            for (const dateDir of await fs.promises.readdir(datalogPath)) {
                if (!/^\d{8}$/.test(dateDir)) continue;
                try {
                    const stat = await fs.promises.stat(path.join(datalogPath, dateDir));
                    // Convert YYYYMMDD → YYYY-MM-DD to match night_date format
                    const dateKey = `${dateDir.slice(0,4)}-${dateDir.slice(4,6)}-${dateDir.slice(6,8)}`;
                    currentMtimes.set(dateKey, stat.mtimeMs);
                } catch { /* skip unreadable dirs */ }
            }
        }

        // A date is skippable only when metrics exist AND folder is unchanged
        const skipDates = new Set(
            cachedRows
                .map(r => r.night_date)
                .filter(date => {
                    const stored = storedMtimes.get(date);
                    const current = currentMtimes.get(date);
                    // If we have no mtime record yet, don't skip (first import for this folder)
                    return stored != null && current != null && stored === current;
                })
        );

        safeInfo(console, `[import] mtime check: ${cachedRows.length} nights with metrics, ${skipDates.size} unchanged → skipping EDF parse`);
        this.primeSTRCache();
        // Pre-seed loader's cached session metrics map so skipped nights still
        // return enriched values when getDailyStats merges them.
        const cachedSessionMetrics = new Map(cachedRows.map(r => [r.night_date, {
            leak50: r.leak_p50, leak95: r.leak_p95, leakMax: null, leakSpikeCount: r.leak_spike_count,
            tidVol50: r.tidal_vol_p50, tidVol95: r.tidal_vol_p95,
            minVent50: r.minute_vent_p50, minVent95: r.minute_vent_p95,
            respRate50: r.resp_rate_p50, respRate95: r.resp_rate_p95,
            flowLimP95: r.flow_limitation_p95, snoreIndex: r.snore_index,
            pressureHistogram: r.pressure_histogram ? JSON.parse(r.pressure_histogram) : null,
            pressureEfficiency: r.pressure_efficiency,
            eventClusterIndexSource: r.event_cluster_index_source,
            spo2Avg: r.spo2_avg, pulseAvg: r.pulse_avg,
            periodicBreathing: (r.pb_episode_count != null) ? {
                episodeCount: r.pb_episode_count, totalPBSeconds: r.pb_total_seconds,
                pbPct: r.pb_pct, avgCycleSec: r.pb_avg_cycle_sec,
                isClinicallySignificant: r.pb_is_significant === 1,
                leakConfounded: r.pb_leak_confounded === 1
            } : null
        }]));

        this.db.exec('BEGIN TRANSACTION;');
        try {
            const summary = await this.loader.loadAll(onProgress, skipDates, cachedSessionMetrics);
            const deviceId = this.upsertDevice();

            let insertedCount = 0;
            let updatedCount = 0;

            const runAnalyticsOn = new Set();

            const upsertNightStmt = this.db.prepare(`
        INSERT INTO nights (id, device_id, night_date, usage_hours)
        VALUES (@id, @device_id, @night_date, @usage_hours)
        ON CONFLICT(device_id, night_date) DO UPDATE SET
          usage_hours = excluded.usage_hours
      `);

            const getNightStmt = this.db.prepare(`SELECT id, usage_hours FROM nights WHERE device_id = ? AND night_date = ?`);

            const upsertMetricsStmt = this.db.prepare(`
        INSERT INTO night_metrics (
          night_id, ahi_total, apneas_per_hr, hypopneas_per_hr,
          obstructive_apneas_per_hr, central_apneas_per_hr, unclassified_apneas_per_hr,
          pressure_median, pressure_p95, leak_p50, leak_p95,
          minute_vent_p50, minute_vent_p95, resp_rate_p50, resp_rate_p95, flow_limitation_p95, event_cluster_index_source,
          tidal_vol_p50, tidal_vol_p95, duration_minutes, on_duration_minutes,
          patient_hours_cumulative, spo2_avg, pulse_avg, data_quality,
          rin_per_hr, csr_per_hr, snore_index, leak_spike_count, pressure_histogram, pressure_efficiency,
          pb_episode_count, pb_total_seconds, pb_pct, pb_avg_cycle_sec, pb_is_significant, pb_leak_confounded
        ) VALUES (
          @night_id, @ahi_total, @apneas_per_hr, @hypopneas_per_hr,
          @obstructive_apneas_per_hr, @central_apneas_per_hr, @unclassified_apneas_per_hr,
          @pressure_median, @pressure_p95, @leak_p50, @leak_p95,
          @minute_vent_p50, @minute_vent_p95, @resp_rate_p50, @resp_rate_p95, @flow_limitation_p95, @event_cluster_index_source,
          @tidal_vol_p50, @tidal_vol_p95, @duration_minutes, @on_duration_minutes,
          @patient_hours_cumulative, @spo2_avg, @pulse_avg, @data_quality,
          @rin_per_hr, @csr_per_hr, @snore_index, @leak_spike_count, @pressure_histogram, @pressure_efficiency,
          @pb_episode_count, @pb_total_seconds, @pb_pct, @pb_avg_cycle_sec, @pb_is_significant, @pb_leak_confounded
        )
        ON CONFLICT(night_id) DO UPDATE SET
          ahi_total = excluded.ahi_total,
          apneas_per_hr = excluded.apneas_per_hr,
          hypopneas_per_hr = excluded.hypopneas_per_hr,
          obstructive_apneas_per_hr = excluded.obstructive_apneas_per_hr,
          central_apneas_per_hr = excluded.central_apneas_per_hr,
          unclassified_apneas_per_hr = excluded.unclassified_apneas_per_hr,
          pressure_median = excluded.pressure_median,
          pressure_p95 = excluded.pressure_p95,
          leak_p50 = excluded.leak_p50,
          leak_p95 = excluded.leak_p95,
          minute_vent_p50 = excluded.minute_vent_p50,
          minute_vent_p95 = excluded.minute_vent_p95,
          resp_rate_p50 = excluded.resp_rate_p50,
          resp_rate_p95 = excluded.resp_rate_p95,
          flow_limitation_p95 = excluded.flow_limitation_p95,
          event_cluster_index_source = excluded.event_cluster_index_source,
          tidal_vol_p50 = excluded.tidal_vol_p50,
          tidal_vol_p95 = excluded.tidal_vol_p95,
          duration_minutes = excluded.duration_minutes,
          on_duration_minutes = excluded.on_duration_minutes,
          patient_hours_cumulative = excluded.patient_hours_cumulative,
          spo2_avg = excluded.spo2_avg,
          pulse_avg = excluded.pulse_avg,
          data_quality = excluded.data_quality,
          rin_per_hr = excluded.rin_per_hr,
          csr_per_hr = excluded.csr_per_hr,
          snore_index = excluded.snore_index,
          leak_spike_count = excluded.leak_spike_count,
          pressure_histogram = excluded.pressure_histogram,
          pressure_efficiency = excluded.pressure_efficiency,
          pb_episode_count = excluded.pb_episode_count,
          pb_total_seconds = excluded.pb_total_seconds,
          pb_pct = excluded.pb_pct,
          pb_avg_cycle_sec = excluded.pb_avg_cycle_sec,
          pb_is_significant = excluded.pb_is_significant,
          pb_leak_confounded = excluded.pb_leak_confounded
      `);

            for (const day of summary.dailyStats || []) {
                // Date strings are like "2023-12-05"
                const existing = getNightStmt.get(deviceId, day.date);

                let nightId = crypto.randomUUID();

                if (existing) {
                    nightId = existing.id;
                    updatedCount++;
                    // Only re-run analytics if the night's EDF data was actually re-parsed.
                    // Skipped nights already have valid derived metrics — no need to recompute.
                    if (!skipDates.has(day.date)) {
                        runAnalyticsOn.add(day.date);
                    }
                } else {
                    insertedCount++;
                    runAnalyticsOn.add(day.date);
                }

                upsertNightStmt.run({
                    id: nightId,
                    device_id: deviceId,
                    night_date: day.date,
                    usage_hours: toOptionalNumber(day.usageHours) ?? 0
                });

                const dq = { missing: [] };
                if (day.leak95 === null) dq.missing.push(day.sourceMetrics?.leak95Field || "leak_p95");
                if (day.tidVol50 === null) dq.missing.push(day.sourceMetrics?.tidVol50Field || "tidal_vol_p50");
                if (day.flowLimP95 === null) dq.missing.push(day.sourceMetrics?.flowLimP95Field || "flow_limitation_p95");
                if (day.pressure === null) dq.missing.push("pressure");

                safeInfo(console,
                    `[import] ${day.date} leak95=${formatDebugValue(day.leak95)} tidal50=${formatDebugValue(day.tidVol50)}`
                );

                upsertMetricsStmt.run({
                    night_id: nightId,
                    ahi_total: toOptionalNumber(day.ahi) ?? 0,
                    apneas_per_hr: toOptionalNumber(day.ai) ?? 0,
                    hypopneas_per_hr: toOptionalNumber(day.hi) ?? 0,
                    obstructive_apneas_per_hr: toOptionalNumber(day.oai) ?? 0,
                    central_apneas_per_hr: toOptionalNumber(day.cai) ?? 0,
                    unclassified_apneas_per_hr: toOptionalNumber(day.uai) ?? 0,
                    pressure_median: toOptionalNumber(day.pressure),
                    pressure_p95: toOptionalNumber(day.maxPressure),
                    leak_p50: toOptionalNumber(day.leak50),
                    leak_p95: toOptionalNumber(day.leak95),
                    minute_vent_p50: toOptionalNumber(day.minVent50),
                    minute_vent_p95: toOptionalNumber(day.minVent95),
                    resp_rate_p50: toOptionalNumber(day.respRate50),
                    resp_rate_p95: toOptionalNumber(day.respRate95 ?? day.respRate50),
                    flow_limitation_p95: toOptionalNumber(day.flowLimP95),
                    event_cluster_index_source: toOptionalNumber(day.eventClusterIndexSource),
                    tidal_vol_p50: toOptionalNumber(day.tidVol50),
                    tidal_vol_p95: toOptionalNumber(day.tidVol95),
                    duration_minutes: toOptionalNumber(day.duration) ?? 0,
                    on_duration_minutes: toOptionalNumber(day.onDuration) ?? 0,
                    patient_hours_cumulative: toOptionalNumber(day.patientHoursCumulative) ?? 0,
                    spo2_avg: toOptionalNumber(day.spo2Avg),
                    pulse_avg: toOptionalNumber(day.pulseAvg),
                    data_quality: JSON.stringify(dq),
                    rin_per_hr: toOptionalNumber(day.rin),
                    csr_per_hr: toOptionalNumber(day.csr),
                    snore_index: toOptionalNumber(day.snoreIndex),
                    leak_spike_count: toOptionalNumber(day.leakSpikeCount),
                    pressure_histogram: day.pressureHistogram ? JSON.stringify(day.pressureHistogram) : null,
                    pressure_efficiency: toOptionalNumber(day.pressureEfficiency),
                    pb_episode_count: toOptionalNumber(day.pbEpisodeCount),
                    pb_total_seconds: toOptionalNumber(day.pbTotalSeconds),
                    pb_pct: toOptionalNumber(day.pbPct),
                    pb_avg_cycle_sec: toOptionalNumber(day.pbAvgCycleSec),
                    pb_is_significant: day.pbIsSignificant == null ? null : (day.pbIsSignificant ? 1 : 0),
                    pb_leak_confounded: day.pbLeakConfounded == null ? null : (day.pbLeakConfounded ? 1 : 0)
                });
            }

            const logId = crypto.randomUUID();
            this.db.prepare(`
        INSERT INTO import_log (id, device_id, folder_path, nights_inserted, nights_updated)
        VALUES (?, ?, ?, ?, ?)
      `).run(logId, deviceId, this.dataPath, insertedCount, updatedCount);

            // Persist current DATALOG folder mtimes so next import can skip unchanged nights.
            const upsertMtime = this.db.prepare(`
        INSERT INTO datalog_folder_mtimes (folder_path, date_dir, mtime_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(folder_path, date_dir) DO UPDATE SET mtime_ms = excluded.mtime_ms
      `);
            for (const [dateKey, mtimeMs] of currentMtimes.entries()) {
                upsertMtime.run(this.dataPath, dateKey, mtimeMs);
            }

            await this.persistSTRCache();

            this.db.exec('COMMIT;');

            return { success: true, summary, deviceId, insertedCount, updatedCount, runAnalyticsOn: Array.from(runAnalyticsOn) };
        } catch (err) {
            this.db.exec('ROLLBACK;');
            console.error("Incremental Import Failed", err);
            return { success: false, error: err.message };
        }
    }

    primeSTRCache() {
        if (typeof this.loader.setSTRCache !== "function") {
            return;
        }

        const readCache = this.db.prepare(`
            SELECT cache_key, value FROM import_file_cache
            WHERE folder_path = ? AND cache_key IN ('str_edf_mtime', 'str_edf_size', 'str_edf_summary')
        `).all(this.dataPath);
        const cache = Object.fromEntries(readCache.map((row) => [row.cache_key, row.value]));
        if (!cache.str_edf_summary) {
            return;
        }

        try {
            this.loader.setSTRCache({
                mtimeMs: Number(cache.str_edf_mtime),
                size: Number(cache.str_edf_size),
                summary: JSON.parse(cache.str_edf_summary)
            });
        } catch {
            this.loader.setSTRCache(null);
        }
    }

    async persistSTRCache() {
        if (!this.loader.dailySummary || this.loader.dailySummary.error) {
            return;
        }

        const strPath = path.join(this.dataPath, "STR.edf");
        if (!fs.existsSync(strPath)) {
            return;
        }

        const stat = await fs.promises.stat(strPath);
        const upsertCache = this.db.prepare(`
            INSERT INTO import_file_cache (folder_path, cache_key, value, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(folder_path, cache_key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
        `);
        upsertCache.run(this.dataPath, "str_edf_mtime", String(stat.mtimeMs));
        upsertCache.run(this.dataPath, "str_edf_size", String(stat.size));
        upsertCache.run(this.dataPath, "str_edf_summary", JSON.stringify(this.loader.dailySummary));
    }

    upsertDevice() {
        const info = this.loader.deviceInfo || {};
        const serial = info.serialNumber || "Unknown";
        const existing = this.db.prepare(`SELECT id FROM devices WHERE serial_number = ?`).get(serial);
        if (existing) {
            return existing.id;
        }
        const id = crypto.randomUUID();
        this.db.prepare(`
      INSERT INTO devices (id, manufacturer, model, serial_number, firmware)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, this.loader.manufacturer || "Unknown", info.productName || "Unknown", serial, info.firmwareVersion || "");
        return id;
    }
}

module.exports = { IncrementalImporter };
