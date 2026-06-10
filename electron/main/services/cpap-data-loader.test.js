const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { CPAPDataLoader, inferDeviceCapabilities } = require("./cpap-data-loader");

// "Test Data/" holds a real SD-card dump and is gitignored, so data-dependent
// tests only run on machines that have it (CI checkouts skip them).
const TEST_DATA_DIR = path.join(process.cwd(), "Test Data");
const hasTestData = fs.existsSync(TEST_DATA_DIR);

test("inferDeviceCapabilities disables oximetry for AirSense-class flow generators", () => {
    const capabilities = inferDeviceCapabilities({ productName: "AirSense 11 AutoSet" });

    assert.equal(capabilities.supportsOximetry, false);
});

test("test data keeps spo2 and pulse null for unsupported devices", { skip: !hasTestData && "Test Data/ not present" }, async () => {
    const loader = new CPAPDataLoader(TEST_DATA_DIR);
    await loader.loadAll();

    const stats = await loader.getDailyStats();
    assert.ok(stats.length > 0);
    assert.ok(stats.every((day) => day.spo2Avg === null));
    assert.ok(stats.every((day) => day.pulseAvg === null));
});
