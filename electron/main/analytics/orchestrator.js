const { computeTherapyStabilityScore, classifyLeakSeverity, computeComplianceRisk, processResidualBurden } = require("./scores");
const { detectOutliers } = require("./outliers");
const { analyzeCorrelations } = require("./correlations");
const { generateInsightNarratives } = require("./explanations");
const crypto = require("crypto");

class AnalyticsOrchestrator {
  constructor(db) {
    this.db = db;
  }

  async runForNights(deviceId, nightDates) {
    if (!nightDates || nightDates.length === 0) return;

    // Sort oldest to newest to compute chronologically
    nightDates.sort();

    const stmtGetHistory = this.db.prepare(`
      SELECT n.usage_hours, m.ahi_total, m.leak_p50, m.leak_p95, m.pressure_median, m.pressure_p95,
             m.minute_vent_p50, m.minute_vent_p95, m.tidal_vol_p50, m.tidal_vol_p95
      FROM nights n
      JOIN night_metrics m ON m.night_id = n.id
      WHERE n.device_id = ? AND n.night_date < ?
      ORDER BY n.night_date DESC
      LIMIT 30
    `);

    const stmtGet14DaysUsage = this.db.prepare(`
      SELECT usage_hours FROM nights 
      WHERE device_id = ? AND night_date <= ?
      ORDER BY night_date DESC
      LIMIT 14
    `);

    const stmtGet30DaysAHI = this.db.prepare(`
      SELECT m.ahi_total FROM nights n
      JOIN night_metrics m ON m.night_id = n.id
      WHERE n.device_id = ? AND n.night_date <= ?
      ORDER BY n.night_date DESC
      LIMIT 30
    `);

    const stmtGetNight = this.db.prepare(`
      SELECT n.id as night_id, n.usage_hours, m.* 
      FROM nights n
      JOIN night_metrics m ON m.night_id = n.id
      WHERE n.device_id = ? AND n.night_date = ?
    `);

    const upsertDerived = this.db.prepare(`
      INSERT INTO derived_metrics (
        night_id, stability_score, mask_fit_score, ventilation_stability_score,
        compliance_risk, pressure_responsiveness, residual_burden, outliers, z_scores,
        therapy_stability_score, leak_severity_tier, leak_consistency_index,
        pressure_variance, flow_limitation_score, event_cluster_index
      ) VALUES (
        @night_id, @stability, @mask_fit, @ventilation,
        @compliance, @pri, @residual, @outliers, @z_scores,
        @therapy_stability_score, @leak_severity_tier, @leak_consistency_index,
        @pressure_variance, @flow_limitation_score, @event_cluster_index
      )
      ON CONFLICT(night_id) DO UPDATE SET
        stability_score = excluded.stability_score,
        mask_fit_score = excluded.mask_fit_score,
        ventilation_stability_score = excluded.ventilation_stability_score,
        compliance_risk = excluded.compliance_risk,
        pressure_responsiveness = excluded.pressure_responsiveness,
        residual_burden = excluded.residual_burden,
        outliers = excluded.outliers,
        z_scores = excluded.z_scores,
        therapy_stability_score = excluded.therapy_stability_score,
        leak_severity_tier = excluded.leak_severity_tier,
        leak_consistency_index = excluded.leak_consistency_index,
        pressure_variance = excluded.pressure_variance,
        flow_limitation_score = excluded.flow_limitation_score,
        event_cluster_index = excluded.event_cluster_index,
        computed_at = datetime('now')
    `);

    const upsertInsight = this.db.prepare(`
        INSERT INTO insights_explanations (id, night_id, key, title, summary, details)
        VALUES (@id, @night_id, @key, @title, @summary, @details)
    `);

    this.db.exec("BEGIN TRANSACTION;");

    try {
      for (const date of nightDates) {
        const current = stmtGetNight.get(deviceId, date);
        if (!current) continue;

        // Fetch historical windows
        // NOTE: history implies strictly *before* current date
        const history30 = stmtGetHistory.all(deviceId, date);
        // Includes current date
        const usage14 = stmtGet14DaysUsage.all(deviceId, date).map(r => r.usage_hours);
        const ahi30 = stmtGet30DaysAHI.all(deviceId, date).map(r => r.ahi_total);

        // Phase 9 Clinical Models
        const clinicalStability = computeTherapyStabilityScore(current, history30);
        const leakClass = classifyLeakSeverity(current.leak_p95 || current.leak_max || current.leak_p50, 0, current.usage_hours * 60);

        // Scores (Legacy kept to prevent breaking other UI temporarily)
        const compliance = computeComplianceRisk(usage14);
        const residual = processResidualBurden(ahi30);
        const { flags, z_scores } = detectOutliers(current, history30);

        upsertDerived.run({
          night_id: current.night_id,
          stability: Math.round(clinicalStability.stabilityScore), // Migrating old UI values proxy
          mask_fit: 0,
          ventilation: 0,
          compliance: compliance,
          pri: 0,
          residual: JSON.stringify(residual),
          outliers: JSON.stringify(flags),
          z_scores: JSON.stringify(z_scores),
          therapy_stability_score: clinicalStability.stabilityScore,
          leak_severity_tier: leakClass.tier,
          leak_consistency_index: leakClass.consistencyIndex,
          pressure_variance: clinicalStability.pressureVariance,
          flow_limitation_score: clinicalStability.flScore,
          event_cluster_index: clinicalStability.clusterIndex
        });

        // Insights / Explanations
        // Updating to pass the new stability formats
        const insights = generateInsightNarratives(current.night_id, {
          stability_score: clinicalStability.stabilityScore,
          mask_fit_score: 100, // Deprecated
          compliance_risk: compliance
        }, flags);

        // Clear old insights for this night to prevent dupes natively (or rely on unique constraints if we add them, but let's delete first)
        this.db.prepare(`DELETE FROM insights_explanations WHERE night_id = ?`).run(current.night_id);

        for (const ins of insights) {
          upsertInsight.run({
            id: crypto.randomUUID(),
            night_id: current.night_id,
            key: ins.key,
            title: ins.title,
            summary: ins.summary,
            details: ins.details
          });
        }
      }

      // Re-run correlations for the device over the last 30 days overall
      const latestNights = this.db.prepare(`
        SELECT n.usage_hours, m.ahi_total, m.leak_p50, m.pressure_median
        FROM nights n
        JOIN night_metrics m ON m.night_id = n.id
        WHERE n.device_id = ?
        ORDER BY n.night_date DESC
        LIMIT 30
      `).all(deviceId);

      const corrs = analyzeCorrelations(latestNights);
      if (corrs.length > 0) {
        this.db.prepare(`
          INSERT INTO correlations (id, device_id, window_days, results)
          VALUES (?, ?, ?, ?)
        `).run(crypto.randomUUID(), deviceId, 30, JSON.stringify(corrs));
      }

      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      console.error("Analytics Orchestration Failed:", err);
    }
  }
}

module.exports = { AnalyticsOrchestrator };
