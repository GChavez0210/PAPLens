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
const { PrismaLineLoader } = require("./prisma-line-loader");
const { ApexLoader } = require("./apex-loader");
const { BmcLoader } = require("./bmc-loader");
const { YuwellLoader } = require("./yuwell-loader");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "paplens-loader-"));
}

// Build a ZIP archive with stored (method 0) entries.  CRC fields are left 0;
// the reader (zip-reader.js) does not validate CRCs.
function buildStoredZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt32LE(0, 14); // crc32 (unchecked)
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    const localFull = Buffer.concat([local, data]);
    locals.push(localFull);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt32LE(0, 16); // crc32 (unchecked)
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += localFull.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
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

test("registry detects and loads Lowenstein Prisma Line summary data", async () => {
  const root = makeTempDir();

  const deviceXml =
    '<?xml version="1.0"?><Device>' +
    '<DeviceType value="22"/>' +
    '<DeviceSerialNumber value="PR123"/>' +
    '<FWVersion value="1.0.0"/>' +
    "</Device>";
  fs.writeFileSync(
    path.join(root, "config.pcfg"),
    buildStoredZip([{ name: "mnt/flash/conf/device.xml", data: deviceXml }])
  );

  // 8 h usage (28800 s) in APAP (mode 2), set pressure 9.00 (v=900).
  const statisticsXml =
    "<statistics>" +
    '<day d="2026-05-26">' +
    '<rec m="2" t="63000-28800">' +
    '<s i="309" v="900"/>' +
    "</rec></day></statistics>";

  // 8 obstructive + 8 central + 8 hypopnea over 8 h => OAI/CAI/HI = 1 each.
  let eventsXml = "<Events>";
  for (let i = 0; i < 8; i++) eventsXml += '<RespEvent RespEventID="101"/>';
  for (let i = 0; i < 8; i++) eventsXml += '<RespEvent RespEventID="102"/>';
  for (let i = 0; i < 8; i++) eventsXml += '<RespEvent RespEventID="111"/>';
  eventsXml += "</Events>";

  fs.writeFileSync(
    path.join(root, "therapy.pdat"),
    buildStoredZip([
      { name: "mnt/flash/data/statistics/statistics_year.bin", data: statisticsXml },
      { name: "mnt/flash/data/therapy/events/20260526/event_000001.xml", data: eventsXml }
    ])
  );

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof PrismaLineLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "Löwenstein Medical");
  assert.equal(summary.deviceInfo.serialNumber, "PR123");
  assert.equal(summary.deviceInfo.productName, "prisma25S");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].date, "2026-05-26");
  assert.equal(summary.dailyStats[0].usageHours, 8);
  assert.equal(summary.dailyStats[0].pressure, 9);
  assert.equal(summary.dailyStats[0].raw.pressureMode, "APAP");
  assert.equal(summary.dailyStats[0].oai, 1);
  assert.equal(summary.dailyStats[0].cai, 1);
  assert.equal(summary.dailyStats[0].hi, 1);
  assert.equal(summary.dailyStats[0].ai, 2);
  assert.equal(summary.dailyStats[0].ahi, 3);
  assert.equal(summary.deviceCapabilities.supportsAHI, true);
});

test("registry detects and loads Apex Medical summary data", async () => {
  const root = makeTempDir();
  const apdata = path.join(root, "APDATA");
  fs.mkdirSync(apdata, { recursive: true });

  // INFO.APC: magic "AP", model @0x02, serial @0x12, firmware @0x1E.
  const info = Buffer.alloc(64);
  info[0] = 0x41; info[1] = 0x50;
  info.write("XT Auto", 0x02, "ascii");
  info.write("AX123", 0x12, "ascii");
  info.write("v2.0", 0x1e, "ascii");
  fs.writeFileSync(path.join(apdata, "INFO.APC"), info);

  // 20260526.APC: 16-byte header + one 48-byte record (8 h APAP).
  const dateToken = (26 << 9) | (5 << 5) | 26; // 2026-05-26
  const file = Buffer.alloc(16 + 0x30);
  file.set([0x41, 0x50, 0x43, 0x00], 0); // "APC\0"
  file.writeUInt32LE(dateToken, 4);
  file.writeUInt16LE(1, 8); // record count
  const r = 16;
  file.writeUInt32LE(1, r);          // start offset (1 s past Apex epoch)
  file.writeUInt16LE(480, r + 0x04); // 8 hours
  file[r + 0x06] = 1;                // mode APAP
  file[r + 0x09] = 75;               // pressure P50 ×10 = 7.5
  file[r + 0x0b] = 100;              // pressure P95 ×10 = 10.0
  file.writeUInt16LE(8, r + 0x0c);   // OA = 8
  file.writeUInt16LE(8, r + 0x0e);   // HI = 8
  file.writeUInt16LE(8, r + 0x10);   // CA = 8
  file[r + 0x12] = 20;               // leak P50
  file[r + 0x13] = 40;               // leak P95
  file[r + 0x15] = 25;               // snore ×10 = 2.5
  file[r + 0x16] = 10;               // flow-lim ×10 = 1.0
  fs.writeFileSync(path.join(apdata, "20260526.APC"), file);

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof ApexLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "Apex Medical");
  assert.equal(summary.deviceInfo.serialNumber, "AX123");
  assert.equal(summary.deviceInfo.productName, "XT Auto");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].date, "2026-05-26");
  assert.equal(summary.dailyStats[0].usageHours, 8);
  assert.equal(summary.dailyStats[0].pressure, 7.5);
  assert.equal(summary.dailyStats[0].maxPressure, 10);
  assert.equal(summary.dailyStats[0].leak50, 20);
  assert.equal(summary.dailyStats[0].leak95, 40);
  assert.equal(summary.dailyStats[0].snoreIndex, 2.5);
  assert.equal(summary.dailyStats[0].flowLimP95, 1);
  assert.equal(summary.dailyStats[0].ahi, 3);
  assert.equal(summary.dailyStats[0].raw.pressureMode, "APAP");
});

test("registry detects and loads BMC RESmart summary data", async () => {
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "data.idx"), Buffer.alloc(0));
  fs.writeFileSync(path.join(root, "data.000"), Buffer.alloc(0));

  const base = 0x102340;
  const buf = Buffer.alloc(base + 0x200);
  buf.write("BMC123", 0x2d, "ascii");
  buf.write("RESmart GII", 0x2296, "ascii");

  buf[base] = 0xe1;                  // session marker
  buf.writeUInt32LE(0, base + 1);    // next offset 0 → session runs to EOF
  buf.writeUInt16LE((26 << 9) | (5 << 5) | 26, base + 0x07); // 2026-05-26
  buf.writeUInt16LE(480, base + 0x0f); // 8 hours
  buf[base + 0x45] = 0xff;           // terminate the 0x45 message block immediately

  // Event data messages at 0x4A: OSA(0x83), HYP(0x84), CSA(0x87), 8 each.
  let p = base + 0x4a;
  for (const type of [0x83, 0x84, 0x87]) {
    buf[p] = type;
    buf.writeUInt16LE(8, p + 1); // count
    buf.writeUInt16LE(0, p + 3); // discard
    p += 5 + 8 * 3;              // 8 × 3-byte events
  }
  fs.writeFileSync(path.join(root, "data.USR"), buf);

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof BmcLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "BMC");
  assert.equal(summary.deviceInfo.serialNumber, "BMC123");
  assert.equal(summary.deviceInfo.productName, "RESmart GII");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].date, "2026-05-26");
  assert.equal(summary.dailyStats[0].usageHours, 8);
  assert.equal(summary.dailyStats[0].oai, 1);
  assert.equal(summary.dailyStats[0].cai, 1);
  assert.equal(summary.dailyStats[0].hi, 1);
  assert.equal(summary.dailyStats[0].ahi, 3);
});

test("registry detects and loads Yuwell (Format A) summary data", async () => {
  const root = makeTempDir();
  fs.writeFileSync(path.join(root, "RunLog.bys"), Buffer.alloc(0));
  const yhDir = path.join(root, "YH-550-Y123");
  fs.mkdirSync(yhDir, { recursive: true });

  const RECORDS = 8;
  const file = Buffer.alloc(0x33 + RECORDS * 10);
  file.set([26, 5, 26, 22, 0, 0], 0); // start 2026-05-26 22:00
  file.set([26, 5, 27, 6, 0, 0], 6);  // finish 2026-05-27 06:00 → 8 h
  file[12] = 0;                       // mode CPAP
  file.write("YH-550-Y123", 0x1e, "ascii"); // model/serial @0x1E
  file.writeInt16LE(RECORDS, 0x2e);   // record count
  for (let i = 0; i < RECORDS; i++) {
    const off = 0x33 + i * 10;
    file[off] = 80;        // pressure ×10 = 8.0
    file[off + 3] = 1;     // OAI
    file[off + 4] = 1;     // HI
    file[off + 5] = 1;     // CAI
    file[off + 9] = 20;    // leak volume
  }
  fs.writeFileSync(path.join(yhDir, "0001.BYS"), file);

  assert.equal(detectDataFolder(root), true);
  const loader = getLoader(root);
  assert.ok(loader instanceof YuwellLoader);

  const summary = await loader.loadAll();
  assert.equal(summary.deviceInfo.manufacturer, "Yuwell");
  assert.equal(summary.deviceInfo.serialNumber, "YH-550-Y123");
  assert.equal(summary.dailyStats.length, 1);
  assert.equal(summary.dailyStats[0].date, "2026-05-26");
  assert.equal(summary.dailyStats[0].usageHours, 8);
  assert.equal(summary.dailyStats[0].pressure, 8);
  assert.equal(summary.dailyStats[0].oai, 1);
  assert.equal(summary.dailyStats[0].cai, 1);
  assert.equal(summary.dailyStats[0].hi, 1);
  assert.equal(summary.dailyStats[0].ahi, 3);
  assert.equal(summary.dailyStats[0].raw.pressureMode, "CPAP");
});
