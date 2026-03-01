const { zScore, mean, std } = require("./rolling");

function detectOutliers(currentMetrics, last30MetricsList) {
    const flags = [];
    const z_scores = {};

    const processMetric = (key, val, limit = 2.5) => {
        if (val === undefined || val === null) return;
        const history = last30MetricsList.map(m => m[key]).filter(v => v !== undefined && v !== null);
        if (history.length === 0) return;

        const mu = mean(history);
        const sigma = std(history, mu);
        const z = zScore(val, mu, sigma);

        z_scores[key] = { z, mu, sigma };

        const absZ = Math.abs(z);
        if (absZ >= limit) {
            flags.push({
                metric: key,
                z: z,
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
