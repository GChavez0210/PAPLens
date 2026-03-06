const { pearsonR } = require("./regression");
const { hasTherapyData } = require("./scores");

function analyzeCorrelations(metricsList) {
    const usableMetrics = (metricsList || []).filter(hasTherapyData);
    if (usableMetrics.length < 2) return [];

    const results = [];

    const checkCorrelation = (keyX, keyY, labelX, labelY) => {
        const pairs = usableMetrics
            .filter(m => m[keyX] !== undefined && m[keyX] !== null && m[keyY] !== undefined && m[keyY] !== null)
            .map(m => [m[keyX], m[keyY]]);

        if (pairs.length < 2) return;

        const xVals = pairs.map(p => p[0]);
        const yVals = pairs.map(p => p[1]);
        const r = pearsonR(xVals, yVals);

        const absR = Math.abs(r);
        let label = "weak";
        if (absR >= 0.6) label = "strong";
        else if (absR >= 0.4) label = "moderate";
        else if (absR >= 0.2) label = "mild";

        results.push({
            x: labelX,
            y: labelY,
            r,
            n: pairs.length,
            label
        });
    };

    checkCorrelation("leak_p50", "ahi_total", "Leak", "AHI");
    checkCorrelation("pressure_median", "ahi_total", "Pressure", "AHI");
    checkCorrelation("usage_hours", "ahi_total", "Usage", "AHI");
    checkCorrelation("pressure_median", "leak_p50", "Pressure", "Leak");

    return results;
}

module.exports = { analyzeCorrelations };
