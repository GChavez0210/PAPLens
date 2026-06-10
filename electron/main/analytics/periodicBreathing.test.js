const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeEpisodes } = require("./periodicBreathing");

// DATA-7: episode boundaries must land on flagged samples, never inside a trailing gap.

const T = 1, F = 0;

// Helper: build a flags array from a compact description
// e.g. flags([T,3], [F,5], [T,3]) → [1,1,1, 0,0,0,0,0, 1,1,1]
function flags(...segments) {
    const out = [];
    for (const [val, len] of segments) {
        for (let i = 0; i < len; i++) out.push(val);
    }
    return out;
}

const MAX_GAP = 5;
const MIN_EP = 3;

test("gap just under MAX_GAP merges two runs into one episode", () => {
    // The close condition is `i - lastFlagged > MAX_GAP`, so a gap of MAX_GAP-1
    // unflagged samples means the max gap index reached is MAX_GAP, which does NOT
    // trigger the close → both runs merge into one episode.
    const f = flags([T, 5], [F, MAX_GAP - 1], [T, 5]);
    const episodes = mergeEpisodes(f, MAX_GAP, MIN_EP);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].startIdx, 0);
    assert.equal(episodes[0].endIdx, f.length - 1); // last flagged sample (end of second run)
});

test("gap just over MAX_GAP splits into two episodes", () => {
    // T×5, F×(MAX_GAP+1), T×5 → two separate episodes
    const f = flags([T, 5], [F, MAX_GAP + 1], [T, 5]);
    const episodes = mergeEpisodes(f, MAX_GAP, MIN_EP);
    assert.equal(episodes.length, 2);
    // First episode ends on last flagged sample of first run (index 4)
    assert.equal(episodes[0].endIdx, 4);
    // Second episode starts at first flagged sample of second run
    assert.equal(episodes[1].startIdx, 5 + MAX_GAP + 1);
});

test("episode endIdx is always a flagged sample", () => {
    // T×10, F×(MAX_GAP+2) — episode must end at index 9, not at 9+gap
    const f = flags([T, 10], [F, MAX_GAP + 2]);
    const episodes = mergeEpisodes(f, MAX_GAP, MIN_EP);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].endIdx, 9);
    assert.equal(f[episodes[0].endIdx], T, "endIdx must be a flagged sample");
});

test("episode shorter than MIN_EPISODE_SAMPLES is discarded", () => {
    const f = flags([T, MIN_EP - 1]);
    const episodes = mergeEpisodes(f, MAX_GAP, MIN_EP);
    assert.equal(episodes.length, 0);
});

test("episode exactly MIN_EPISODE_SAMPLES long is kept", () => {
    const f = flags([T, MIN_EP]);
    const episodes = mergeEpisodes(f, MAX_GAP, MIN_EP);
    assert.equal(episodes.length, 1);
});

test("no flags produces no episodes", () => {
    const f = flags([F, 100]);
    const episodes = mergeEpisodes(f, MAX_GAP, MIN_EP);
    assert.equal(episodes.length, 0);
});

test("trailing gap at end of signal does not inflate episode length", () => {
    // T×20, F×(MAX_GAP+5) at end — episode must end at index 19
    const f = flags([T, 20], [F, MAX_GAP + 5]);
    const episodes = mergeEpisodes(f, MAX_GAP, MIN_EP);
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].endIdx, 19);
});
