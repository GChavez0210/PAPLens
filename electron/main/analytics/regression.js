const { EPSILON, mean } = require("./rolling");

function regressionSlope(yValues) {
    const n = yValues.length;
    if (n <= 1) return 0;

    const tValues = Array.from({ length: n }, (_, i) => i);
    const mu_t = mean(tValues);
    const mu_y = mean(yValues);

    let cov = 0;
    let var_t = 0;

    for (let i = 0; i < n; i++) {
        const dt = tValues[i] - mu_t;
        cov += dt * (yValues[i] - mu_y);
        var_t += dt * dt;
    }

    if (var_t === 0) return 0;
    return cov / var_t;
}

function pearsonR(xValues, yValues) {
    const n = xValues.length;
    if (n !== yValues.length || n <= 1) return 0;

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
    return denominator === 0 ? 0 : cov / denominator;
}

module.exports = { regressionSlope, pearsonR };
