const test = require("node:test");
const assert = require("node:assert/strict");
const { pearsonR } = require("./regression");

// DATA-3: pearsonR must return null for n < 3 and for zero-variance inputs

test("pearsonR returns null for n=2 (always ±1, meaningless)", () => {
    assert.equal(pearsonR([1, 2], [1, 2]), null);
});

test("pearsonR returns null when x has zero variance", () => {
    assert.equal(pearsonR([5, 5, 5], [1, 2, 3]), null);
});

test("pearsonR returns null when y has zero variance", () => {
    assert.equal(pearsonR([1, 2, 3], [7, 7, 7]), null);
});

test("pearsonR returns ~1 for a perfect positive linear relationship (n=5)", () => {
    const r = pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    assert.ok(r !== null && Math.abs(r - 1) < 1e-9, `expected ~1, got ${r}`);
});

test("pearsonR returns ~-1 for a perfect inverse relationship", () => {
    const r = pearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    assert.ok(r !== null && Math.abs(r + 1) < 1e-9, `expected ~-1, got ${r}`);
});

test("pearsonR returns null for empty arrays", () => {
    assert.equal(pearsonR([], []), null);
});
