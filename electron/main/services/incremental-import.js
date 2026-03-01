const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CPAPDataLoader } = require("./cpap-data-loader");

class IncrementalImporter {
    constructor(db, dataPath) {
        this.db = db;
        this.dataPath = dataPath;
        this.loader = new CPAPDataLoader(dataPath);
    }

    async runImport() {
        this.db.exec('BEGIN TRANSACTION;');
        try {
            const summary = await this.loader.loadAll();
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
          pressure_median, pressure_p95, leak_p50, leak_p95,
          minute_vent_p50, minute_vent_p95, resp_rate_p50, resp_rate_p95,
          tidal_vol_p50, tidal_vol_p95, data_quality
        ) VALUES (
          @night_id, @ahi_total, @apneas_per_hr, @hypopneas_per_hr,
          @pressure_median, @pressure_p95, @leak_p50, @leak_p95,
          @minute_vent_p50, @minute_vent_p95, @resp_rate_p50, @resp_rate_p95,
          @tidal_vol_p50, @tidal_vol_p95, @data_quality
        )
        ON CONFLICT(night_id) DO UPDATE SET
          ahi_total = excluded.ahi_total,
          apneas_per_hr = excluded.apneas_per_hr,
          hypopneas_per_hr = excluded.hypopneas_per_hr,
          pressure_median = excluded.pressure_median,
          pressure_p95 = excluded.pressure_p95,
          leak_p50 = excluded.leak_p50,
          leak_p95 = excluded.leak_p95,
          minute_vent_p50 = excluded.minute_vent_p50,
          minute_vent_p95 = excluded.minute_vent_p95,
          resp_rate_p50 = excluded.resp_rate_p50,
          resp_rate_p95 = excluded.resp_rate_p95,
          tidal_vol_p50 = excluded.tidal_vol_p50,
          tidal_vol_p95 = excluded.tidal_vol_p95,
          data_quality = excluded.data_quality
      `);

            for (const day of summary.dailyStats || []) {
                // Date strings are like "2023-12-05"
                const existing = getNightStmt.get(deviceId, day.date);

                let nightId = crypto.randomUUID();
                let shouldUpdateMetrics = true;

                if (existing) {
                    nightId = existing.id;
                    if (Math.abs(existing.usage_hours - day.usageHours) < 0.01) {
                        // Already completely imported and usage hasn't changed, skip to save compute
                        shouldUpdateMetrics = false;
                    } else {
                        updatedCount++;
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
                    usage_hours: day.usageHours || 0
                });

                if (shouldUpdateMetrics) {
                    const dq = { missing: [] };
                    if (!day.raw["Leak.95"]) dq.missing.push("Leak.95");
                    if (!day.raw["S.C.Press"] && !day.raw["S.AS.MinPress"]) dq.missing.push("pressure");

                    upsertMetricsStmt.run({
                        night_id: nightId,
                        ahi_total: day.ahi || 0,
                        apneas_per_hr: day.ai || 0,
                        hypopneas_per_hr: day.hi || 0,
                        pressure_median: day.pressure || 0,
                        pressure_p95: day.maxPressure || 0, // Fallback
                        leak_p50: day.leak50 || 0,
                        leak_p95: day.leak95 || 0,
                        minute_vent_p50: day.minVent50 || 0,
                        minute_vent_p95: day.minVent95 || 0,
                        resp_rate_p50: day.respRate50 || 0, // Approx
                        resp_rate_p95: day.respRate50 || 0,
                        tidal_vol_p50: day.tidVol50 || 0,
                        tidal_vol_p95: day.tidVol95 || 0,
                        data_quality: JSON.stringify(dq)
                    });
                }
            }

            const logId = crypto.randomUUID();
            this.db.prepare(`
        INSERT INTO import_log (id, device_id, folder_path, nights_inserted, nights_updated)
        VALUES (?, ?, ?, ?, ?)
      `).run(logId, deviceId, this.dataPath, insertedCount, updatedCount);

            this.db.exec('COMMIT;');

            return { success: true, summary, deviceId, insertedCount, updatedCount, runAnalyticsOn: Array.from(runAnalyticsOn) };
        } catch (err) {
            this.db.exec('ROLLBACK;');
            console.error("Incremental Import Failed", err);
            return { success: false, error: err.message };
        }
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
    `).run(id, "ResMed", info.productName || "Unknown", serial, info.firmwareVersion || "");
        return id;
    }
}

module.exports = { IncrementalImporter };
