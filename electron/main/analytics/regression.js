const { mean } = require("./rolling");

function regressionSlope(yValues) {
    const n = yValues.length;
    if (n <= 1) return { slope: 0, intercept: n === 1 ? yValues[0] : 0, r2: 0, se: null, n };

    const tValues = Array.from({ length: n }, (_, i) => i);
    const mu_t = mean(tValues);
    const mu_y = mean(yValues);

    let cov = 0;
    let var_t = 0;
    let totalY = 0;

    for (let i = 0; i < n; i++) {
        const dt = tValues[i] - mu_t;
        const dy = yValues[i] - mu_y;
        cov += dt * dy;
        var_t += dt * dt;
        totalY += dy * dy;
    }

    if (var_t === 0) return { slope: 0, intercept: mu_y, r2: 0, se: null, n };

    const slope = cov / var_t;
    const intercept = mu_y - slope * mu_t;

    let residualSumSquares = 0;
    for (let i = 0; i < n; i++) {
        const fitted = intercept + slope * tValues[i];
        residualSumSquares += Math.pow(yValues[i] - fitted, 2);
    }

    const r2 = totalY === 0 ? 0 : Math.max(0, Math.min(1, 1 - residualSumSquares / totalY));
    const se = n > 2 ? Math.sqrt((residualSumSquares / (n - 2)) / var_t) : null;
    return { slope, intercept, r2, se, n };
}

function regressionSlopeValue(yValues) {
    return regressionSlope(yValues).slope;
}

const PEARSON_EPSILON = 1e-10;

function pearsonR(xValues, yValues) {
    const n = xValues.length;
    if (n !== yValues.length || n < 3) return null;

    const mu_x = mean(xValues);
    const mu_y = mean(yValues);

    let cov = 0;
    let var_x = 0;
    let var_y = 0;

    for (let i = 0; i < n; i++) {
        const dx = xValues[i] - mu_x;
        const dy = yValues[i] - mu_y;
        cov += dx * dy;
        var_x += dx * dx;
        var_y += dy * dy;
    }

    const denominator = Math.sqrt(var_x * var_y);
    if (denominator < PEARSON_EPSILON) return null;
    return cov / denominator;
}

module.exports = { regressionSlope, regressionSlopeValue, pearsonR };
