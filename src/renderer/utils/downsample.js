/**
 * Returns an array of indices to keep when downsampling a series of `length`
 * points to at most `target` points.  Always includes the first and last index.
 * If length <= target, returns all indices (identity mapping).
 *
 * @param {number} length  Total number of data points in the series.
 * @param {number} target  Desired maximum number of points.
 * @returns {Uint32Array}  Sorted array of indices to retain.
 */
export function downsampleIndices(length, target) {
    if (length <= target) {
        return Uint32Array.from({ length }, (_, i) => i);
    }

    const indices = new Uint32Array(target);
    indices[0] = 0;
    indices[target - 1] = length - 1;

    for (let i = 1; i < target - 1; i++) {
        // Evenly spaced positions across [0, length-1]
        indices[i] = Math.round((i / (target - 1)) * (length - 1));
    }

    return indices;
}
