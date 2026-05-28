const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getLoader, detectDataFolder } = require("./loader-registry");
const { ResventLoader } = require("./resvent-loader");
const { DeVilbissLoader } = require("./devilbiss-loader");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "paplens-loader-"));
}

function writeResventWaveform(filePath) {
  const buf = Buffer.alloc(0x24 + 0x20 * 2 + 2 * 2 * 3);
  buf.writeUInt16LE(2, 0x12);
  buf.write("Pressure", 0x24, "ascii");
  buf.write("Leak", 0x24 + 0x20, "ascii");

  let pos = 0x24 + 0x20 * 2;
  for (const [pressure, leak] of [
    [1000, 50],
    [1200, 70],
    [1400, 90]
  ]) {
    buf.writeInt16LE(pressure, pos);
    buf.writeInt16LE(leak, pos + 2);
    pos += 4;
  }

  fs.writeFileSync(filePath, buf);
}

test("registry detects and loads Resvent summary data", async () => {
  const root = makeTempDir();
  const configDir = path.join(root, "THERAPY", "CONFIG");
  const dayDir = path.join(root, "THERAPY", "RECORD", "202605", "26");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(dayDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "CFG"), "SerialNo=RV123\nModel=iBreezer Auto\nFW=1.2.3\n");
  fs.writeFileSync(path.join(dayDir, "STAT1"), "secUsed=7200\ncntAHI=8\ncntOAI=4\ncntCAI=2\ncntHI=2\ncntAI=6\n");
  writeResventWaveform(path.join(dayDir, "P1_0"));

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof ResventLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "Resvent");
  assert.equal(summary.deviceInfo.serialNumber, "RV123");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].date, "2026-05-26");
  assert.equal(summary.dailyStats[0].ahi, 4);
  assert.equal(summary.dailyStats[0].usageHours, 2);
  assert.equal(summary.dailyStats[0].pressure, 12);
  assert.equal(summary.dailyStats[0].leak95, 8.8);
});

test("registry detects and loads DeVilbiss DV6 summary data", async () => {
  const root = makeTempDir();
  const dv6 = path.join(root, "DV6");
  fs.mkdirSync(dv6, { recursive: true });
  fs.writeFileSync(path.join(dv6, "VER.BIN"), Buffer.from("X\0DV123\0DV64\0", "ascii"));
  fs.writeFileSync(path.join(dv6, "SET.BIN"), Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));

  const buf = Buffer.alloc(56 + 55);
  const off = 56;
  const startRaw = Date.UTC(2026, 4, 26, 6, 0, 0) / 1000 - 1009843200;
  const stopRaw = startRaw + 8 * 3600;
  buf.writeUInt32BE(startRaw, off);
  buf.writeUInt32BE(stopRaw, off + 4);
  buf[off + 12] = 80;
  buf[off + 16] = 100;
  buf[off + 18] = 120;
  buf[off + 23] = 40;
  buf[off + 25] = 60;
  buf.writeUInt16LE(520, off + 27);
  buf[off + 29] = 15;
  buf[off + 33] = 20;
  buf[off + 36] = 4;
  buf[off + 37] = 2;
  buf[off + 38] = 6;
  fs.writeFileSync(path.join(dv6, "S.BIN"), buf);

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof DeVilbissLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "DeVilbiss");
  assert.equal(summary.deviceInfo.serialNumber, "DV123");
  assert.equal(summary.deviceInfo.productName, "IntelliPAP Auto DV64");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].date, "2026-05-26");
  assert.equal(summary.dailyStats[0].ahi, 3);
  assert.equal(summary.dailyStats[0].usageHours, 8);
  assert.equal(summary.dailyStats[0].flowLimP95, 0.1);
});
