const { classifyLeakSeverity, computeMaskFitScore } = require("./clinicalInsights");
const {
  computeTherapyStabilityScore,
  computeComplianceRisk,
  processResidualBurden,
  hasTherapyData
} = require("./scores");
const { detectOutliers } = require("./outliers");
const { analyzeCorrelations } = require("./correlations");
const {
  generateInsightNarratives,
  generatePeriodicBreathingInsight,
  generateFlowLimitationInsight
} = require("./explanations");
const { detectChronicMissingFields } = require("./diagnostics");
const { AnalyticsDataAccess } = require("./dataAccess");
const crypto = require("crypto");

class AnalyticsOrchestrator {
  constructor(db) {
    this.db = db;
    this.dataAccess = new AnalyticsDataAccess(db);
  }

  async runForNights(deviceId, nightDates) {
    if (!nightDates || nightDates.length === 0) return;

    nightDates.sort();

    try {
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

      this.dataAccess.beginTransaction();

      const allNights = this.dataAccess.getNightsRange(deviceId, null, nightDates[nightDates.length - 1]);
      const nightsByDate = new Map(allNights.map((night) => [night.night_date, night]));

      for (const date of nightDates) {
        const current = nightsByDate.get(date);
        if (!current) continue;

        const upToCurrent = allNights.filter((night) => night.night_date <= date);
        const history30 = upToCurrent
          .filter((night) => night.night_date < date && hasTherapyData(night))
          .slice(-30)
          .reverse();
        const usage14 = upToCurrent
          .slice(-14)
          .reverse()
          .map((night) => night.usage_hours);
        const ahi30 = upToCurrent
          .filter(hasTherapyData)
          .slice(-30)
          .reverse()
          .map((night) => night.ahi_total);

        this.db.prepare(`DELETE FROM insights_explanations WHERE night_id = ?`).run(current.night_id);

        if (!hasTherapyData(current)) {
          upsertDerived.run({
            night_id: current.night_id,
            stability: null,
            mask_fit: null,
            ventilation: null,
            compliance: null,
            pri: null,
            residual: null,
            outliers: JSON.stringify([]),
            z_scores: JSON.stringify({}),
            therapy_stability_score: null,
            leak_severity_tier: null,
            leak_consistency_index: null,
            pressure_variance: null,
            flow_limitation_score: null,
            event_cluster_index: null
          });
          continue;
        }

        const clinicalStability = computeTherapyStabilityScore(current, history30);
        const leakForClassify = current.leak_p95 ?? current.leak_max ?? current.leak_p50;
        const leakBasis = current.leak_p95 != null || current.leak_max != null ? "p95" : "p50";
        const leakClass = classifyLeakSeverity(leakForClassify, current.leak_p50, current.usage_hours * 60, {
          basis: leakBasis
        });
        const maskFitScore = computeMaskFitScore(current);
        const compliance = computeComplianceRisk(usage14);
        const residual = processResidualBurden(ahi30);
        const { flags, z_scores } = detectOutliers(current, history30);

        upsertDerived.run({
          night_id: current.night_id,
          stability: clinicalStability.stabilityScore == null ? null : Math.round(clinicalStability.stabilityScore),
          mask_fit: maskFitScore,
          ventilation: null,
          compliance,
          pri: null,
          residual: residual ? JSON.stringify(residual) : null,
          outliers: JSON.stringify(flags),
          z_scores: JSON.stringify(z_scores),
          therapy_stability_score: clinicalStability.stabilityScore,
          leak_severity_tier: leakClass.tier,
          leak_consistency_index: leakClass.consistencyIndex,
          pressure_variance: clinicalStability.pressureVariance,
          flow_limitation_score: clinicalStability.flScore,
          event_cluster_index: current.event_cluster_index_source ?? clinicalStability.clusterIndex
        });

        const insights = generateInsightNarratives(
          current.night_id,
          {
            stability_score: clinicalStability.stabilityScore,
            mask_fit_score: maskFitScore,
            compliance_risk: compliance
          },
          flags
        );

        const pbInsight = generatePeriodicBreathingInsight(
          current.pb_pct,
          current.pb_is_significant === 1,
          current.pb_episode_count,
          current.pb_leak_confounded === 1
        );
        if (pbInsight) insights.push(pbInsight);

        const nightsElevatedFL = history30.filter(
          (h) => h.flow_limitation_p95 != null && h.flow_limitation_p95 >= 0.1
        ).length;
        const flInsight = generateFlowLimitationInsight(
          current.flow_limitation_p95,
          current.rin_per_hr,
          nightsElevatedFL
        );
        if (flInsight) insights.push(flInsight);

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

      // Warn (once per run) about metrics missing for >10 consecutive stored therapy
      // nights. This intentionally scans full history through the latest processed
      // date so incremental imports still catch streaks that started earlier.
      const perNightMissing = allNights.filter(hasTherapyData).map((night) => ({
        date: night.night_date,
        missingFields: computeTherapyStabilityScore(night, []).missingFields
      }));
      detectChronicMissingFields(perNightMissing);

      const latestNights = this.dataAccess.getLatestNightsForCorrelations(deviceId, 30);
      const corrs = analyzeCorrelations(latestNights);
      this.db.prepare(`DELETE FROM correlations WHERE device_id = ? AND window_days = 30`).run(deviceId);
      if (corrs.length > 0) {
        this.db
          .prepare(
            `
          INSERT INTO correlations (id, device_id, window_days, results)
          VALUES (?, ?, ?, ?)
        `
          )
          .run(crypto.randomUUID(), deviceId, 30, JSON.stringify(corrs));
      }

      this.dataAccess.commitTransaction();
    } catch (err) {
      try {
        this.dataAccess.rollbackTransaction();
      } catch {
        // Rollback failure should not hide the original analytics error.
      }
      console.error("Analytics Orchestration Failed:", err);
    }
  }
}

module.exports = { AnalyticsOrchestrator };
