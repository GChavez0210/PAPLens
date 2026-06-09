/**
 * Periodic Breathing / Cheyne-Stokes detection.
 *
 * Operates on the 2-second tidal volume signal (normalized mL) produced by
 * sessionMetrics.normalizeTidalSamples. A Cheyne-Stokes / periodic breathing
 * cycle is 30–120 seconds, well within the resolution of 2-second epochs.
 *
 * Algorithm:
 *   1. Apply a 5-sample (10s) centred moving average to remove breath noise.
 *   2. For each sample, compute oscillation depth across a ±22-sample (88s) window:
 *      depth = (windowMax − windowMin) / windowMean
 *   3. Flag samples where depth ≥ 0.60 (60% amplitude variation).
 *   4. Merge consecutive flagged runs (tolerating a 30-second gap) into episodes.
 *      Discard episodes shorter than 180 seconds.
 *   5. Estimate cycle length per episode by counting smoothed-signal peaks.
 *      Discard episodes without ≥3 peaks in the 30–120s period range (AASM minimum).
 *
 * Clinical significance threshold: PB% ≥ 5% of total recording time.
 */

const SAMPLE_INTERVAL_SEC = 2;
const SMOOTH_HALF_WIN = 2;          // ±2 samples → 5-sample window (10s)
const OSC_HALF_WIN = 22;            // ±22 samples → 45-sample window (88s)
const PB_DEPTH_THRESHOLD = 0.60;   // 60% amplitude/mean ratio — raises bar above normal breath-to-breath variability
const MIN_SIGNAL_ML = 50;          // Discard if mean tidal < 50 mL (no valid signal)
const MIN_EPISODE_SAMPLES = 90;    // 180 seconds minimum episode length (≥3 cycles at 60s/cycle)
const MAX_GAP_SAMPLES = 15;        // 30-second gap tolerance between flagged runs
const MIN_VALID_CYCLES = 3;        // AASM requires at least 3 full crescendo-decrescendo cycles
const MIN_CYCLE_SEC = 30;
const MAX_CYCLE_SEC = 120;
const CLINICAL_SIGNIFICANCE_PCT = 5.0;

// Leak-confounding detection constants
const LEAK_CONFOUND_TROUGH_RATIO = 0.50;  // ≥50% of troughs must coincide with elevated leak
const TROUGH_AMPLITUDE_RATIO = 0.50;      // trough = sample below 50% of episode mean
const LEAK_ELEVATION_PERCENTILE = 0.75;   // "elevated" = above session 75th-percentile leak
const LEAK_TROUGH_HALF_WIN = 2;           // ±4 seconds around each trough

function centredMovingAverage(arr, halfWin) {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
        const lo = Math.max(0, i - halfWin);
        const hi = Math.min(arr.length - 1, i + halfWin);
        let sum = 0;
        for (let j = lo; j <= hi; j++) sum += arr[j];
        out[i] = sum / (hi - lo + 1);
    }
    return out;
}

function countPeaks(arr) {
    let count = 0;
    for (let i = 1; i < arr.length - 1; i++) {
        if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1]) count++;
    }
    return count;
}

// Merge a Uint8Array (or boolean array) of per-sample flags into episode objects.
// Episode boundaries land on the last flagged sample (never inside a trailing gap).
function mergeEpisodes(flags, maxGapSamples, minEpisodeSamples) {
    const episodes = [];
    let epStart = -1;
    let lastFlagged = -1;

    const closeEpisode = () => {
        if (epStart !== -1 && lastFlagged - epStart + 1 >= minEpisodeSamples) {
            episodes.push({ startIdx: epStart, endIdx: lastFlagged });
        }
        epStart = -1;
        lastFlagged = -1;
    };

    for (let i = 0; i < flags.length; i++) {
        if (flags[i]) {
            if (epStart === -1) epStart = i;
            lastFlagged = i;
        } else if (epStart !== -1 && i - lastFlagged > maxGapSamples) {
            closeEpisode();
        }
    }
    closeEpisode();
    return episodes;
}

function sessionLeakThreshold(leakSamples) {
    if (!leakSamples || leakSamples.length === 0) return null;
    const sorted = Float64Array.from(leakSamples).sort();
    return sorted[Math.min(Math.floor(sorted.length * LEAK_ELEVATION_PERCENTILE), sorted.length - 1)];
}

function isLeakConfoundedEpisode(smoothedSlice, leakSamples, startIdx, leakThreshold) {
    if (!leakSamples || leakSamples.length === 0 || leakThreshold == null) return false;
    const epMean = smoothedSlice.reduce((a, b) => a + b, 0) / smoothedSlice.length;
    const troughThreshold = epMean * TROUGH_AMPLITUDE_RATIO;

    let troughCount = 0;
    let leakCoincidentCount = 0;
    for (let i = 0; i < smoothedSlice.length; i++) {
        if (smoothedSlice[i] <= troughThreshold) {
            troughCount++;
            const lo = Math.max(0, startIdx + i - LEAK_TROUGH_HALF_WIN);
            const hi = Math.min(leakSamples.length - 1, startIdx + i + LEAK_TROUGH_HALF_WIN);
            for (let j = lo; j <= hi; j++) {
                if (leakSamples[j] > leakThreshold) { leakCoincidentCount++; break; }
            }
        }
    }
    return troughCount > 0 && leakCoincidentCount / troughCount >= LEAK_CONFOUND_TROUGH_RATIO;
}

/**
 * @param {number[]} tidalMlSamples  Normalized tidal volume in mL at 2-second intervals.
 * @param {number[]} [leakSamples]   Leak rate samples at 2-second intervals (same alignment).
 * @returns {object|null}            Detection result, or null if insufficient data.
 */
function detectPeriodicBreathing(tidalMlSamples, leakSamples) {
    const N = tidalMlSamples ? tidalMlSamples.length : 0;
    const totalSec = N * SAMPLE_INTERVAL_SEC;

    if (N < 60) return null; // Need at least 2 minutes

    const globalMean = tidalMlSamples.reduce((a, b) => a + b, 0) / N;
    if (globalMean < MIN_SIGNAL_ML) return null;

    const smoothed = centredMovingAverage(tidalMlSamples, SMOOTH_HALF_WIN);

    // Step 2: per-sample oscillation depth using sliding window
    const pbFlags = new Uint8Array(N);
    for (let i = OSC_HALF_WIN; i < N - OSC_HALF_WIN; i++) {
        let lo = Infinity, hi = -Infinity, sum = 0;
        const count = 2 * OSC_HALF_WIN + 1;
        for (let j = i - OSC_HALF_WIN; j <= i + OSC_HALF_WIN; j++) {
            const v = smoothed[j];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
            sum += v;
        }
        const winMean = sum / count;
        if (winMean > MIN_SIGNAL_ML && (hi - lo) / winMean >= PB_DEPTH_THRESHOLD) {
            pbFlags[i] = 1;
        }
    }

    // Step 3: merge flagged runs into episodes.
    const episodes = mergeEpisodes(pbFlags, MAX_GAP_SAMPLES, MIN_EPISODE_SAMPLES);

    if (episodes.length === 0) {
        return { episodeCount: 0, totalPBSeconds: 0, pbPct: 0, avgCycleSec: null, isClinicallySignificant: false };
    }

    // Step 4: per-episode cycle estimation and validity check.
    // Episodes without confirmed cyclic structure (≥3 peaks, cycle in 30–120s) are discarded.
    let totalPBSamples = 0;
    let weightedCycleSec = 0;
    let totalPeaks = 0;
    const validEpisodes = [];

    for (const ep of episodes) {
        const epLen = ep.endIdx - ep.startIdx + 1;
        const epSec = epLen * SAMPLE_INTERVAL_SEC;
        const slice = smoothed.slice(ep.startIdx, ep.endIdx + 1);
        const peaks = countPeaks(slice);
        const cycleSec = peaks > 0 ? epSec / peaks : null;

        ep.startSec = ep.startIdx * SAMPLE_INTERVAL_SEC;
        ep.durationSec = epSec;
        ep.estimatedCycles = peaks;
        ep.cycleSec = cycleSec ? Math.round(cycleSec) : null;

        // Require confirmed cyclic structure: ≥3 complete cycles with period in the PB range.
        if (peaks < MIN_VALID_CYCLES || !cycleSec || cycleSec < MIN_CYCLE_SEC || cycleSec > MAX_CYCLE_SEC) {
            continue;
        }

        validEpisodes.push(ep);
        totalPBSamples += epLen;
        weightedCycleSec += cycleSec * peaks;
        totalPeaks += peaks;
    }

    if (validEpisodes.length === 0) {
        return { episodeCount: 0, totalPBSeconds: 0, pbPct: 0, avgCycleSec: null, isClinicallySignificant: false };
    }

    const totalPBSec = totalPBSamples * SAMPLE_INTERVAL_SEC;
    const pbPct = totalSec > 0 ? (totalPBSec / totalSec) * 100 : 0;
    const avgCycleSec = totalPeaks > 0 ? Math.round(weightedCycleSec / totalPeaks) : null;
    const isClinicallySignificant = pbPct >= CLINICAL_SIGNIFICANCE_PCT;

    // Check if the majority of valid episodes appear leak-confounded (arousal-driven CAs).
    const leakThreshold = sessionLeakThreshold(leakSamples);
    const confoundedCount = validEpisodes.filter(ep =>
        isLeakConfoundedEpisode(smoothed.slice(ep.startIdx, ep.endIdx + 1), leakSamples, ep.startIdx, leakThreshold)
    ).length;
    const leakConfounded = confoundedCount > validEpisodes.length / 2;

    return {
        episodeCount: validEpisodes.length,
        totalPBSeconds: Math.round(totalPBSec),
        pbPct: Math.round(pbPct * 10) / 10,
        avgCycleSec,
        isClinicallySignificant,
        leakConfounded,
        _episodes: episodes   // raw merged episodes (before cycle validation) for testing
    };
}

module.exports = { detectPeriodicBreathing, mergeEpisodes };
