const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isValidFolderPath } = require("./ipcRouter");

test("isValidFolderPath accepts normalized absolute directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paplens-ipc-folder-"));

    try {
        assert.equal(isValidFolderPath(dir), true);
        assert.equal(isValidFolderPath(path.join(dir, ".")), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("isValidFolderPath rejects non-strings, relative paths, files, and missing paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paplens-ipc-folder-"));
    const filePath = path.join(dir, "file.txt");
    fs.writeFileSync(filePath, "not a directory");

    try {
        assert.equal(isValidFolderPath(null), false);
        assert.equal(isValidFolderPath("relative\\path"), false);
        assert.equal(isValidFolderPath(filePath), false);
        assert.equal(isValidFolderPath(path.join(dir, "missing")), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
