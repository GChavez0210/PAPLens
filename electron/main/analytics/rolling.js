const EPSILON = 1e-9;

function mean(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function std(values, mu) {
    if (!values || values.length <= 1) return 0;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mu, 2), 0) / (values.length - 1); // Sample variance
    return Math.sqrt(variance);
}

function zScore(x, mu, sigma) {
    return (x - mu) / Math.max(sigma, EPSILON);
}

function cv(sigma, mu) {
    return sigma / Math.max(mu, EPSILON);
}

module.exports = { EPSILON, mean, std, zScore, cv };
