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

        if (pairs.length < 3) return;

        const xVals = pairs.map(p => p[0]);
        const yVals = pairs.map(p => p[1]);
        const r = pearsonR(xVals, yVals);
        if (r === null) return;

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

    // Therapy response index: does a night with higher delivered pressure (N) predict
    // lower AHI the following night (N+1)?  Uses a lag-1 shift.
    if (usableMetrics.length >= 3) {
        const lagPairs = [];
        for (let i = 0; i < usableMetrics.length - 1; i++) {
            const pressureN = usableMetrics[i].pressure_median;
            const ahiNext = usableMetrics[i + 1].ahi_total;
            if (pressureN !== undefined && pressureN !== null && ahiNext !== undefined && ahiNext !== null) {
                lagPairs.push([pressureN, ahiNext]);
            }
        }
        if (lagPairs.length >= 3) {
            const xVals = lagPairs.map(p => p[0]);
            const yVals = lagPairs.map(p => p[1]);
            const r = pearsonR(xVals, yVals);
            if (r !== null) {
                const absR = Math.abs(r);
                let label = "weak";
                if (absR >= 0.6) label = "strong";
                else if (absR >= 0.4) label = "moderate";
                else if (absR >= 0.2) label = "mild";
                results.push({ x: "Pressure (N)", y: "AHI (N+1)", r, n: lagPairs.length, label, lag: 1 });
            }
        }
    }

    return results;
}

module.exports = { analyzeCorrelations };
