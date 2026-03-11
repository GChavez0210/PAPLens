const crypto = require("crypto");
const { CPAPDataLoader } = require("./cpap-data-loader");
const { formatDebugValue, safeInfo, toOptionalNumber } = require("./therapyMetrics");

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
          obstructive_apneas_per_hr, central_apneas_per_hr, unclassified_apneas_per_hr,
          pressure_median, pressure_p95, leak_p50, leak_p95,
          minute_vent_p50, minute_vent_p95, resp_rate_p50, resp_rate_p95, flow_limitation_p95, event_cluster_index_source,
          tidal_vol_p50, tidal_vol_p95, duration_minutes, on_duration_minutes,
          patient_hours_cumulative, spo2_avg, pulse_avg, data_quality
        ) VALUES (
          @night_id, @ahi_total, @apneas_per_hr, @hypopneas_per_hr,
          @obstructive_apneas_per_hr, @central_apneas_per_hr, @unclassified_apneas_per_hr,
          @pressure_median, @pressure_p95, @leak_p50, @leak_p95,
          @minute_vent_p50, @minute_vent_p95, @resp_rate_p50, @resp_rate_p95, @flow_limitation_p95, @event_cluster_index_source,
          @tidal_vol_p50, @tidal_vol_p95, @duration_minutes, @on_duration_minutes,
          @patient_hours_cumulative, @spo2_avg, @pulse_avg, @data_quality
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
          data_quality = excluded.data_quality
      `);

            for (const day of summary.dailyStats || []) {
                // Date strings are like "2023-12-05"
                const existing = getNightStmt.get(deviceId, day.date);

                let nightId = crypto.randomUUID();

                if (existing) {
                    nightId = existing.id;
                    updatedCount++;
                    runAnalyticsOn.add(day.date);
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
                    data_quality: JSON.stringify(dq)
                });
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
