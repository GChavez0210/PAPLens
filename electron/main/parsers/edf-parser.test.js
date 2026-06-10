const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { EDFParser, parseSessionFile } = require("./edf-parser");

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

function writeField(buffer, offset, length, value) {
    buffer.write(String(value).slice(0, length).padEnd(length, " "), offset, length, "ascii");
}

function createEdfBuffer({ numSignals = 1, numDataRecords = 1, headerBytes = 256 + numSignals * 256, samplesPerRecord = [1], includeData = true } = {}) {
    const recordBytes = samplesPerRecord.reduce((sum, samples) => sum + samples, 0) * 2;
    const dataBytes = includeData ? numDataRecords * recordBytes : 0;
    const buffer = Buffer.alloc(headerBytes + dataBytes, " ");

    writeField(buffer, 0, 8, "0");
    writeField(buffer, 8, 80, "Test Patient");
    writeField(buffer, 88, 80, "Test Recording");
    writeField(buffer, 168, 8, "01.01.26");
    writeField(buffer, 176, 8, "00.00.00");
    writeField(buffer, 184, 8, headerBytes);
    writeField(buffer, 236, 8, numDataRecords);
    writeField(buffer, 244, 8, 1);
    writeField(buffer, 252, 4, numSignals);

    if (numSignals > 0 && headerBytes >= 256 + numSignals * 256) {
        let offset = 256;
        const writeSignalField = (length, values) => {
            for (let i = 0; i < numSignals; i++) {
                writeField(buffer, offset + i * length, length, values[i] ?? values[0] ?? "");
            }
            offset += numSignals * length;
        };
        writeSignalField(16, ["Flow"]);
        writeSignalField(80, [""]);
        writeSignalField(8, [""]);
        writeSignalField(8, ["-1"]);
        writeSignalField(8, ["1"]);
        writeSignalField(8, ["-32768"]);
        writeSignalField(8, ["32767"]);
        writeSignalField(80, [""]);
        writeSignalField(8, samplesPerRecord);
        writeSignalField(32, [""]);
    }

    return buffer;
}

test("EDFParser rejects impossible numSignals values", () => {
    const buffer = createEdfBuffer({ numSignals: 999, headerBytes: 256 });

    assert.throws(() => new EDFParser().parseBuffer(buffer), /EDF header out of range/);
});

test("EDFParser rejects oversized samples per record", () => {
    const buffer = createEdfBuffer({ samplesPerRecord: [100001] });

    assert.throws(() => new EDFParser().parseBuffer(buffer), /EDF header out of range/);
});

test("EDFParser rejects declared data records that exceed the buffer", () => {
    const buffer = createEdfBuffer({ numDataRecords: 2, samplesPerRecord: [1], includeData: false });

    assert.throws(() => new EDFParser().parseBuffer(buffer), /EDF header out of range/);
});
