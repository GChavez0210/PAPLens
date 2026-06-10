const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseSessionFile } = require("./edf-parser");

// "Test Data/" holds a real SD-card dump and is gitignored, so this test only
// runs on machines that have it (CI checkouts skip it).
const TEST_DATA_DIR = path.join(process.cwd(), "Test Data");
const hasTestData = fs.existsSync(TEST_DATA_DIR);

test("parseSessionFile decodes EDF annotations from EVE files", { skip: !hasTestData && "Test Data/ not present" }, () => {
    const filePath = path.join(TEST_DATA_DIR, "DATALOG", "20250915", "20250915_234150_EVE.edf");
    const parsed = parseSessionFile(filePath);
    const annotations = parsed.data["EDF Annotations"];

    assert.ok(Array.isArray(annotations));
    assert.ok(annotations.some((annotation) => /central apnea/i.test(annotation.text)));
    assert.ok(annotations.some((annotation) => /hypopnea/i.test(annotation.text)));
});
