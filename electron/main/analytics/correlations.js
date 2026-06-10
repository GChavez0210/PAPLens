const { pearsonR } = require("./regression");
const { hasTherapyData } = require("./scores");

const BETACF_MAX_ITERATIONS = 100;
const BETACF_EPSILON = 3e-7;
const BETACF_FPMIN = 1e-30;

function gammln(xx) {
    const cof = [
        76.180091729471,
        -86.505320329417,
        24.014098240831,
        -1.23173957245,
        0.001208650974,
        -0.000005395239
    ];
    let x = xx - 1;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.00000000019;
    for (let j = 0; j < cof.length; j++) {
        x += 1;
        ser += cof[j] / x;
    }
    return -tmp + Math.log(2.506628274631 * ser);
}

function betacf(a, b, x) {
    let qab = a + b;
    let qap = a + 1;
    let qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
    d = 1 / d;
    let h = d;

    for (let m = 1; m <= BETACF_MAX_ITERATIONS; m++) {
        const m2 = 2 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
        c = 1 + aa / c;
        if (Math.abs(c) < BETACF_FPMIN) c = BETACF_FPMIN;
        d = 1 / d;
        h *= d * c;

        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
        c = 1 + aa / c;
        if (Math.abs(c) < BETACF_FPMIN) c = BETACF_FPMIN;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < BETACF_EPSILON) break;
    }

    return h;
}

function betai(a, b, x) {
    if (x < 0 || x > 1) return NaN;
    if (x === 0 || x === 1) return x;
    const bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) {
        return bt * betacf(a, b, x) / a;
    }
    return 1 - bt * betacf(b, a, 1 - x) / b;
}

function pearsonPValue(r, n) {
    if (!Number.isFinite(r) || n < 3) return null;
    const bounded = Math.max(-0.999999999999, Math.min(0.999999999999, r));
    const df = n - 2;
    const t = Math.abs(bounded) * Math.sqrt(df / Math.max(1 - bounded * bounded, Number.EPSILON));
    const x = df / (df + t * t);
    const p = betai(df / 2, 0.5, x);
    return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;
}

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
        const pValue = pearsonPValue(r, pairs.length);
        const significant = pValue !== null && pValue < 0.05;
        let label = "weak";
        if (absR >= 0.6) label = "strong";
        else if (absR >= 0.4) label = "moderate";
        else if (absR >= 0.2) label = "mild";

        results.push({
            x: labelX,
            y: labelY,
            r,
            n: pairs.length,
            pValue,
            significant,
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
                const pValue = pearsonPValue(r, lagPairs.length);
                const significant = pValue !== null && pValue < 0.05;
                let label = "weak";
                if (absR >= 0.6) label = "strong";
                else if (absR >= 0.4) label = "moderate";
                else if (absR >= 0.2) label = "mild";
                results.push({ x: "Pressure (N)", y: "AHI (N+1)", r, n: lagPairs.length, pValue, significant, label, lag: 1 });
            }
        }
    }

    return results;
}

module.exports = { analyzeCorrelations, pearsonPValue };
