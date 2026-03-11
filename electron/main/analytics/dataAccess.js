const { TherapySessionRepository } = require("../repositories/therapySessionRepository");
const { NightMetricsRepository } = require("../repositories/nightMetricsRepository");

class AnalyticsDataAccess {
    constructor(db) {
        this.sessionRepo = new TherapySessionRepository(db);
        this.metricsRepo = new NightMetricsRepository(db);
        this.db = db; // Needed for raw transaction commits if orchestrator still handles it
    }

    getNightHistoryMatrix(deviceId, date, limit = 30) {
        return this.db.prepare(`
        SELECT n.usage_hours, m.ahi_total, m.leak_p50, m.leak_p95, m.pressure_median, m.pressure_p95,
               m.minute_vent_p50, m.minute_vent_p95, m.tidal_vol_p50, m.tidal_vol_p95, m.flow_limitation_p95
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.night_date < ? AND n.usage_hours > 0
        ORDER BY n.night_date DESC LIMIT ?
      `).all(deviceId, date, limit);
    }

    get14DaysUsage(deviceId, date) {
        return this.db.prepare(`
        SELECT usage_hours FROM nights
        WHERE device_id = ? AND night_date <= ?
        ORDER BY night_date DESC LIMIT 14
      `).all(deviceId, date).map(r => r.usage_hours);
    }

    get30DaysAHI(deviceId, date) {
        return this.db.prepare(`
        SELECT m.ahi_total FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.night_date <= ? AND n.usage_hours > 0
        ORDER BY n.night_date DESC LIMIT 30
      `).all(deviceId, date).map(r => r.ahi_total);
    }

    getNight(deviceId, date) {
        return this.db.prepare(`
        SELECT n.id as night_id, n.usage_hours, m.*
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.night_date = ?
      `).get(deviceId, date);
    }

    getLatestNightsForCorrelations(deviceId, limit = 30) {
        return this.metricsRepo.getNightsWithLimit(deviceId, limit);
    }

    beginTransaction() { this.db.exec("BEGIN TRANSACTION;"); }
    commitTransaction() { this.db.exec("COMMIT;"); }
    rollbackTransaction() { this.db.exec("ROLLBACK;"); }
}

module.exports = { AnalyticsDataAccess };
