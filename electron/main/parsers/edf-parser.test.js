const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { parseSessionFile } = require("./edf-parser");

test("parseSessionFile decodes EDF annotations from EVE files", () => {
    const filePath = path.join(process.cwd(), "Test Data", "DATALOG", "20250915", "20250915_234150_EVE.edf");
    const parsed = parseSessionFile(filePath);
    const annotations = parsed.data["EDF Annotations"];

    assert.ok(Array.isArray(annotations));
    assert.ok(annotations.some((annotation) => /central apnea/i.test(annotation.text)));
    assert.ok(annotations.some((annotation) => /hypopnea/i.test(annotation.text)));
});
