const { zScore, mean, std } = require("./rolling");
const { hasTherapyData } = require("./scores");

function detectOutliers(currentMetrics, last30MetricsList) {
    if (!hasTherapyData(currentMetrics)) {
        return { flags: [], z_scores: {} };
    }

    const flags = [];
    const z_scores = {};
    const validHistory = (last30MetricsList || []).filter(hasTherapyData);

    const processMetric = (key, val, limit = 2.5) => {
        if (val === undefined || val === null) return;
        const history = validHistory.map(m => m[key]).filter(v => v !== undefined && v !== null);
        if (history.length === 0) return;

        const mu = mean(history);
        const sigma = std(history, mu);
        const z = zScore(val, mu, sigma);

        z_scores[key] = { z, mu, sigma };

        const absZ = Math.abs(z);
        if (absZ >= limit) {
            flags.push({
                metric: key,
                z,
                severity: absZ > 3.0 ? "strong" : "mild"
            });
        }
    };

    processMetric("ahi_total", currentMetrics.ahi_total);
    processMetric("pressure_median", currentMetrics.pressure_median);
    processMetric("leak_p50", currentMetrics.leak_p50);
    processMetric("minute_vent_p50", currentMetrics.minute_vent_p50);
    processMetric("tidal_vol_p50", currentMetrics.tidal_vol_p50);
    processMetric("usage_hours", currentMetrics.usage_hours);

    return { flags, z_scores };
}

module.exports = { detectOutliers };
