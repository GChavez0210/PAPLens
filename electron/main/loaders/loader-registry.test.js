const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getLoader, detectDataFolder } = require("./loader-registry");
const { ResventLoader } = require("./resvent-loader");
const { DeVilbissLoader } = require("./devilbiss-loader");
const { FisherPaykelLoader } = require("./fisher-paykel-loader");
const { LowensteinLoader } = require("./lowenstein-loader");

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

function encodeFpTimestamp(year, month, day, hour, minute, second) {
  return (
    day |
    (month << 5) |
    ((year - 2000) << 9) |
    (second << 15) |
    (minute << 21) |
    (hour << 27)
  ) >>> 0;
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

test("registry detects and loads Fisher Paykel SleepStyle summary data", async () => {
  const root = makeTempDir();
  const machineDir = path.join(root, "FPHCARE", "ICON", "FP123");
  fs.mkdirSync(machineDir, { recursive: true });

  const header = Buffer.alloc(0x200, 0x20);
  const headerText = "h1\rversion\rSUM001.fph\rFP123\rSleepStyle\rABCA\rSLEEPSTYLE\r;";
  header.write(headerText, 0, "ascii");

  const rec = Buffer.alloc(40);
  rec.writeUInt32LE(encodeFpTimestamp(2026, 5, 26, 22, 30, 0), 0);
  rec[5] = 80; // 8 hours in 6-minute units
  rec[6] = 70; // min pressure seen
  rec[7] = 95; // 95th percentile pressure
  rec[8] = 120; // max pressure seen
  rec[26] = 80; // fixed CPAP set pressure, differs from p95/max => APAP

  const term = Buffer.alloc(4);
  term.writeUInt32LE(0xffffffff, 0);
  fs.writeFileSync(path.join(machineDir, "SUM001.fph"), Buffer.concat([header, rec, term]));

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof FisherPaykelLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "Fisher & Paykel");
  assert.equal(summary.deviceInfo.serialNumber, "FP123");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].usageHours, 8);
  assert.equal(summary.dailyStats[0].pressure, 7);
  assert.equal(summary.dailyStats[0].maxPressure, 9.5);
});

test("registry detects and loads Lowenstein WM_DATA summary data", async () => {
  const root = makeTempDir();
  const buf = Buffer.alloc(32 + 6 + 34 + 6);
  buf.set([0x57, 0x4d, 0x01, 0x00], 0);
  buf.write("Prisma SMART", 4, "ascii");
  buf.write("WM123", 20, "ascii");

  let off = 32;
  buf[off] = 0x01;
  buf[off + 1] = 0x00;
  buf.writeUInt16LE(40, off + 2);
  buf.writeUInt16LE(0, off + 4);

  off += 6;
  buf.writeUInt16LE(2026, off);
  buf[off + 2] = 5;
  buf[off + 3] = 26;
  buf.writeUInt32LE(22 * 3600, off + 4);
  buf.writeUInt16LE(480, off + 8);
  buf[off + 10] = 1;
  buf[off + 13] = 75;
  buf[off + 14] = 105;
  buf.writeUInt16LE(12, off + 15);
  buf.writeUInt16LE(5, off + 17);
  buf.writeUInt16LE(3, off + 19);
  buf.writeUInt16LE(4, off + 21);
  buf[off + 23] = 6;
  buf[off + 24] = 14;
  buf[off + 26] = 11;
  buf[off + 27] = 2;

  off += 34;
  buf[off] = 0xff;
  buf.writeUInt16LE(6, off + 2);
  fs.writeFileSync(path.join(root, "WM_DATA.TDF"), buf);

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof LowensteinLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "Lowenstein Medical");
  assert.equal(summary.deviceInfo.serialNumber, "WM123");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].date, "2026-05-26");
  assert.equal(summary.dailyStats[0].ahi, 1.2);
  assert.equal(summary.dailyStats[0].usageHours, 8);
  assert.equal(summary.dailyStats[0].pressure, 7.5);
  assert.equal(summary.dailyStats[0].maxPressure, 10.5);
});
