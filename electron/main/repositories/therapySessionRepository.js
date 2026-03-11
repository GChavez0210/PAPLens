class TherapySessionRepository {
    constructor(db) {
        this.db = db;
        // Pre-compile prepared statements for performance and security
        this.stmts = {
            insertNight: db.prepare(`
        INSERT INTO nights(id, device_id, night_date, start_ts, end_ts, usage_hours)
        VALUES(@id, @device_id, @night_date, @start_ts, @end_ts, @usage_hours)
        ON CONFLICT(device_id, night_date) DO UPDATE SET
          start_ts = excluded.start_ts,
          end_ts = excluded.end_ts,
          usage_hours = excluded.usage_hours
      `),
            getNightsByDateRange: db.prepare(`
        SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage, 
               m.pressure_median AS pressure, m.leak_p50 AS leak, m.minute_vent_p50 AS mv, 
               m.resp_rate_p50 AS rr, m.tidal_vol_p50 AS tv
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 AND n.night_date >= ? AND n.night_date <= ?
        ORDER BY n.night_date DESC
      `),
            getNightsWithLimit: db.prepare(`
        SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage, 
               m.pressure_median AS pressure, m.leak_p50 AS leak, m.minute_vent_p50 AS mv, 
               m.resp_rate_p50 AS rr, m.tidal_vol_p50 AS tv
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0
        ORDER BY n.night_date DESC LIMIT ?
      `),
            getMissingDerivedMetrics: db.prepare(`
        SELECT n.night_date 
        FROM nights n
        LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 AND (d.night_id IS NULL OR d.therapy_stability_score IS NULL)
        ORDER BY n.night_date DESC LIMIT 90
      `),
            getLatestDevice: db.prepare(`
        SELECT d.* FROM nights n
        JOIN devices d ON d.id = n.device_id
        ORDER BY n.night_date DESC, n.created_at DESC LIMIT 1
      `),
            getDeviceBySerial: db.prepare('SELECT id FROM devices WHERE serial_number = ?')
        };
    }

    insertTherapySession(session) {
        return this.stmts.insertNight.run(session);
    }

    getNightsByDateRange(deviceId, startDate, endDate) {
        return this.stmts.getNightsByDateRange.all(deviceId, startDate, endDate);
    }

    getNightsWithLimit(deviceId, limit) {
        return this.stmts.getNightsWithLimit.all(deviceId, limit);
    }

    getMissingDerivedMetrics(deviceId) {
        return this.stmts.getMissingDerivedMetrics.all(deviceId).map(r => r.night_date);
    }

    getLatestDevice() {
        return this.stmts.getLatestDevice.get();
    }

    getDeviceBySerial(serialNumber) {
        return this.stmts.getDeviceBySerial.get(serialNumber);
    }
}

module.exports = { TherapySessionRepository };
