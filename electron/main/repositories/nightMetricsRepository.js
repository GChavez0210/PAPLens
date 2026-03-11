function parseJsonSafely(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
}

class NightMetricsRepository {
    constructor(db) {
        this.db = db;
        this.stmts = {
            getNightStats: db.prepare(`
        SELECT n.night_date, d.therapy_stability_score, d.leak_severity_tier, d.leak_consistency_index
        FROM nights n JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ?
      `),
            getAllNightMetrics: db.prepare(`
        SELECT n.night_date AS date, COALESCE(m.ahi_total, 0) AS ahi, COALESCE(m.apneas_per_hr, 0) AS ai,
          COALESCE(m.hypopneas_per_hr, 0) AS hi, COALESCE(m.obstructive_apneas_per_hr, 0) AS oai,
          COALESCE(m.central_apneas_per_hr, 0) AS cai, COALESCE(m.unclassified_apneas_per_hr, 0) AS uai,
          COALESCE(m.duration_minutes, n.usage_hours * 60, 0) AS duration, COALESCE(m.on_duration_minutes, n.usage_hours * 60, 0) AS onDuration,
          COALESCE(n.usage_hours, 0) AS usageHours, COALESCE(m.patient_hours_cumulative, 0) AS patientHoursCumulative,
          m.leak_p50 AS leak50, m.leak_p95 AS leak95, m.pressure_median AS pressure,
          COALESCE(m.pressure_p95, m.pressure_median) AS maxPressure, m.minute_vent_p50 AS minVent50,
          m.minute_vent_p95 AS minVent95, m.tidal_vol_p50 AS tidVol50, m.tidal_vol_p95 AS tidVol95,
          m.resp_rate_p50 AS respRate50, m.spo2_avg AS spo2Avg, m.pulse_avg AS pulseAvg,
          d.stability_score, d.therapy_stability_score, d.mask_fit_score, d.leak_severity_tier, d.leak_consistency_index,
          d.pressure_variance, d.flow_limitation_score, d.event_cluster_index, m.data_quality
        FROM nights n LEFT JOIN night_metrics m ON m.night_id = n.id LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? ORDER BY n.night_date ASC
      `),
            getLastNightOverview: db.prepare(`
        SELECT n.id AS night_id, n.night_date, m.ahi_total, m.pressure_median, m.leak_p50, n.usage_hours,
               d.stability_score, d.therapy_stability_score, d.mask_fit_score, d.compliance_risk, d.outliers
        FROM nights n JOIN night_metrics m ON m.night_id = n.id LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 ORDER BY n.night_date DESC LIMIT 1
      `),
            getLast7NightsAhi: db.prepare(`
        SELECT n.night_date AS date, m.ahi_total AS ahi
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 ORDER BY n.night_date DESC LIMIT 7
      `),
            getInsightsRange: db.prepare(`
        SELECT n.night_date, m.ahi_total, n.usage_hours, m.pressure_median, m.leak_p50, m.leak_p95,
               m.minute_vent_p50, m.resp_rate_p50, m.tidal_vol_p50, d.residual_burden
        FROM nights n JOIN night_metrics m ON m.night_id = n.id LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 AND n.night_date BETWEEN ? AND ? ORDER BY n.night_date DESC
      `),
            getInsightsLimit: db.prepare(`
        SELECT n.night_date, m.ahi_total, n.usage_hours, m.pressure_median, m.leak_p50, m.leak_p95,
               m.minute_vent_p50, m.resp_rate_p50, m.tidal_vol_p50, d.residual_burden
        FROM nights n JOIN night_metrics m ON m.night_id = n.id LEFT JOIN derived_metrics d ON d.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0 ORDER BY n.night_date DESC LIMIT ?
      `),
            getLatestCorrelations: db.prepare(`
        SELECT results FROM correlations WHERE device_id = ? AND window_days = ? ORDER BY computed_at DESC LIMIT 1
      `),
            getExplanationsLatest: db.prepare(`
        SELECT title, summary, details, key, night_id 
        FROM insights_explanations 
        WHERE night_id IN (SELECT id FROM nights WHERE device_id = ? AND usage_hours > 0 ORDER BY night_date DESC LIMIT 7)
        ORDER BY created_at DESC LIMIT 10
      `),
            getOverallLeakStatistics: db.prepare(`
        SELECT AVG(m.leak_p50) as avgLeak50, AVG(m.leak_p95) as avgLeak95
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0
      `),
            getNightsWithLimit: db.prepare(`
        SELECT n.night_date AS date, m.ahi_total AS ahi, n.usage_hours AS usage,
               m.pressure_median AS pressure, m.leak_p50 AS leak_p50, m.leak_p95 AS leak_p95,
               m.minute_vent_p50 AS minute_vent_p50, m.resp_rate_p50 AS resp_rate_p50, m.tidal_vol_p50 AS tidal_vol_p50
        FROM nights n JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ? AND n.usage_hours > 0
        ORDER BY n.night_date DESC LIMIT ?
      `)
        };
    }

    getNightStats(deviceId) { return this.stmts.getNightStats.all(deviceId); }

    getAllNightMetrics(deviceId) {
        const rows = this.stmts.getAllNightMetrics.all(deviceId);
        return rows.map((row) => ({
            ...row,
            raw: { dataQuality: parseJsonSafely(row.data_quality), pressure_median: row.pressure }
        }));
    }

    getLastNightOverview(deviceId) { return this.stmts.getLastNightOverview.get(deviceId); }
    getLast7NightsAhi(deviceId) { return this.stmts.getLast7NightsAhi.all(deviceId).reverse(); }

    getInsights(deviceId, days, from, to) {
        if (from && to) return this.stmts.getInsightsRange.all(deviceId, from, to);
        return this.stmts.getInsightsLimit.all(deviceId, days === 0 ? 99999 : days);
    }

    getLatestCorrelations(deviceId, windowDays) {
        const row = this.stmts.getLatestCorrelations.get(deviceId, windowDays);
        return row && row.results ? JSON.parse(row.results) : [];
    }

    getExplanationsLatest(deviceId) { return this.stmts.getExplanationsLatest.all(deviceId); }

    calculateLeakStatistics(deviceId) {
        return this.stmts.getOverallLeakStatistics.get(deviceId);
    }

    getNightsWithLimit(deviceId, limit) {
        return this.stmts.getNightsWithLimit.all(deviceId, limit);
    }
}

module.exports = { NightMetricsRepository };
