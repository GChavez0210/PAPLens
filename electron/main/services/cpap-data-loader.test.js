const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { CPAPDataLoader, inferDeviceCapabilities } = require("./cpap-data-loader");

test("inferDeviceCapabilities disables oximetry for AirSense-class flow generators", () => {
    const capabilities = inferDeviceCapabilities({ productName: "AirSense 11 AutoSet" });

    assert.equal(capabilities.supportsOximetry, false);
});

test("test data keeps spo2 and pulse null for unsupported devices", async () => {
    const loader = new CPAPDataLoader(path.join(process.cwd(), "Test Data"));
    await loader.loadAll();

    const stats = loader.getDailyStats();
    assert.ok(stats.length > 0);
    assert.ok(stats.every((day) => day.spo2Avg === null));
    assert.ok(stats.every((day) => day.pulseAvg === null));
});
