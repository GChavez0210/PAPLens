/**
 * Pure deterministic mathematical calculations for the analytics pipeline.
 * No specific logic tied directly to DB rows, just pure maps and reductions.
 */

function calculateMean(array) {
    if (!array || array.length === 0) return 0;
    return array.reduce((a, b) => a + b, 0) / array.length;
}

function calculateStandardDeviation(array, mean = null) {
    if (!array || array.length < 2) return 0;
    const avg = mean !== null ? mean : calculateMean(array);
    const variance = array.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / (array.length - 1);
    return Math.sqrt(variance);
}

function computeZScore(value, array) {
    if (!array || array.length < 2) return 0;
    const mean = calculateMean(array);
    const std = calculateStandardDeviation(array, mean);
    if (std === 0) return 0;
    return (value - mean) / std;
}

function computeRollingAverage(array, windowSize) {
    if (!array || array.length === 0) return [];
    const result = [];
    for (let i = 0; i < array.length; i++) {
        const window = array.slice(Math.max(0, i - windowSize + 1), i + 1);
        result.push(calculateMean(window));
    }
    return result;
}

function computePearsonCorrelation(x, y) {
    if (x.length !== y.length || x.length < 2) return 0;
    const meanX = calculateMean(x);
    const meanY = calculateMean(y);

    let num = 0;
    let denX = 0;
    let denY = 0;

    for (let i = 0; i < x.length; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }

    if (denX === 0 || denY === 0) return 0;
    return num / Math.sqrt(denX * denY);
}

module.exports = {
    calculateMean,
    calculateStandardDeviation,
    computeZScore,
    computeRollingAverage,
    computePearsonCorrelation
};
