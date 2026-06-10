"use strict";

// Yuwell / BreathCare loader (YH-series; all use .BYS binary files).
//
// Supports four SD-card layouts:
//   A  YH-550        RunLog.bys in root + YH-*/*.BYS
//   B  YH-580 etc.   YHSD-NEW.BYS (exactly 64 KB) in root
//   C  YH-830 etc.   YH-*/*.BYS without a root RunLog.bys
//   D  YH-680/690    YH-*/RunLog.bys + numbered session subdirectories
//
// Derived from open-cpap cpap-parser (GPL-3.0-or-later) src/parsers/yuwell.rs,
// which ports OSCAR's yuwell_loader.cpp.  Summary-level: usage, therapy mode,
// per-day AHI/OAI/CAI/HI, and average pressure where the format records it.
// See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");

const YUWELL_CPAP = 0x00;

class YuwellLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "Yuwell";
  }

  getDeviceCapabilities() {
    return {
      ...super.getDeviceCapabilities(),
      supportsAHI: true
    };
  }

  static detect(sdCardPath) {
    if (isFormatB(sdCardPath)) return true;
    return findYhDirs(sdCardPath).some(({ dir }) =>
      bysFilesIn(dir).length > 0 || hasSubdir(dir)
    );
  }

  async loadAll(onProgress) {
    const root = this.dataPath;
    let result = null;
    if (await detectFormatAAsync(root)) result = await parseFormatAAsync(root);
    else if (await isFormatBAsync(root)) result = await parseFormatBAsync(root);
    else if (await detectFormatDAsync(root)) result = await parseFormatDAsync(root);
    else if (await detectFormatCAsync(root)) result = await parseFormatCAsync(root);

    if (!result) {
      this.deviceInfo = defaultDeviceInfo("Unknown");
      return this.buildSummary(this.deviceInfo, []);
    }

    this.deviceInfo = result.deviceInfo;
    const dailyStats = aggregateSessions(result.sessions, (date) => this.blankDay(date));
    if (onProgress) onProgress({ done: dailyStats.length, total: dailyStats.length });
    return this.buildSummary(this.deviceInfo, dailyStats);
  }
}

// ── Cursor over a Buffer with bounds-safe reads ──────────────────────────────
class Cursor {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  get remaining() { return this.buf.length - this.pos; }
  u8() {
    if (this.pos + 1 > this.buf.length) throw new RangeError("EOF");
    return this.buf[this.pos++];
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  skip(n) { this.pos += n; }
}

// ── Timestamp helpers (UTC) ──────────────────────────────────────────────────
function yuwellTs(yearOffset, month, day, hour, minute, second) {
  return makeTs(2000 + yearOffset, month, day, hour, minute, second);
}
function makeTs(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return ms;
}
function dateStringUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function modeName(mode) {
  return mode === YUWELL_CPAP ? "CPAP" : "APAP";
}

// ── Directory helpers ────────────────────────────────────────────────────────
function findYhDirs(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory() && e.name.toUpperCase().startsWith("YH"))
    .map(e => ({ name: e.name, dir: path.join(root, e.name) }));
}
async function findYhDirsAsync(root) {
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory() && e.name.toUpperCase().startsWith("YH"))
    .map(e => ({ name: e.name, dir: path.join(root, e.name) }));
}
function bysFilesIn(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(name => name.toUpperCase().endsWith(".BYS"))
      .sort()
      .map(name => path.join(dir, name));
  } catch {
    return [];
  }
}
async function bysFilesInAsync(dir) {
  try {
    return (await fs.promises.readdir(dir))
      .filter(name => name.toUpperCase().endsWith(".BYS"))
      .sort()
      .map(name => path.join(dir, name));
  } catch {
    return [];
  }
}
function hasSubdir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some(e => e.isDirectory());
  } catch {
    return false;
  }
}
async function hasSubdirAsync(dir) {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true })).some(e => e.isDirectory());
  } catch {
    return false;
  }
}
async function readModelSerialAtAsync(filePath, offset) {
  let data;
  try {
    data = await fs.promises.readFile(filePath);
  } catch {
    return null;
  }
  if (data.length < offset + 16) return null;
  let s = "";
  for (let i = offset; i < offset + 16; i++) {
    if (data[i] === 0) break;
    s += String.fromCharCode(data[i]);
  }
  s = s.trim();
  return s.toUpperCase().startsWith("YH") ? s : null;
}
function asciiTrimmed(cur, len) {
  let s = "";
  let stopped = false;
  for (let i = 0; i < len; i++) {
    const b = cur.u8();
    if (b === 0) stopped = true;
    if (!stopped) s += String.fromCharCode(b);
  }
  return s.trim();
}

// ── Shared utilities ─────────────────────────────────────────────────────────
function defaultDeviceInfo(modelSerial) {
  return {
    serialNumber: modelSerial || "Unknown",
    productName: `Yuwell ${modelSerial || ""}`.trim(),
    productCode: "YUWELL",
    machineId: "Unknown",
    firmwareVersion: "Unknown"
  };
}

// Each session: { date, usageHours, oa, hi, ca, avgPressure|null, mode }.
function aggregateSessions(sessions, makeBlankDay) {
  const dayMap = new Map();
  for (const s of sessions) {
    if (!s || s.usageHours <= 0) continue;
    let acc = dayMap.get(s.date);
    if (!acc) {
      acc = { date: s.date, usageHours: 0, oa: 0, hi: 0, ca: 0, pAcc: 0, pWeight: 0, dominantHours: 0, dominantMode: 0 };
      dayMap.set(s.date, acc);
    }
    acc.usageHours += s.usageHours;
    acc.oa += s.oa;
    acc.hi += s.hi;
    acc.ca += s.ca;
    if (s.avgPressure != null && s.avgPressure > 0) {
      acc.pAcc += s.avgPressure * s.usageHours;
      acc.pWeight += s.usageHours;
    }
    if (s.usageHours > acc.dominantHours) {
      acc.dominantHours = s.usageHours;
      acc.dominantMode = s.mode;
    }
  }

  const dailyStats = [];
  for (const acc of dayMap.values()) {
    const h = acc.usageHours;
    const day = makeBlankDay(acc.date);
    day.usageHours = h;
    day.onDuration = h * 60;
    if (acc.pWeight > 0) {
      const p = acc.pAcc / acc.pWeight;
      day.pressure = p;
      day.maxPressure = p;
    }
    const oai = acc.oa / h;
    const cai = acc.ca / h;
    const hiIdx = acc.hi / h;
    day.oai = oai;
    day.cai = cai;
    day.hi = hiIdx;
    day.ai = oai + cai;
    day.ahi = oai + cai + hiIdx;
    day.raw.pressureMode = modeName(acc.dominantMode);
    dailyStats.push(day);
  }
  return dailyStats.sort((a, b) => a.date.localeCompare(b.date));
}

function computeUsageHours(startTs, finishTs) {
  return Math.max(0, finishTs - startTs) / 3_600_000;
}

// ── Format A ─────────────────────────────────────────────────────────────────
async function detectFormatAAsync(root) {
  if (!fs.existsSync(path.join(root, "RunLog.bys"))) return false;
  const yhDirs = await findYhDirsAsync(root);
  for (const { dir } of yhDirs) {
    const files = await bysFilesInAsync(dir);
    if (files.length > 0 && await readModelSerialAtAsync(files[0], 0x1e) != null) {
      return true;
    }
  }
  return false;
}
async function parseFormatAAsync(root) {
  const yhDirs = await findYhDirsAsync(root);
  if (!yhDirs.length) return null;
  const files = await bysFilesInAsync(yhDirs[0].dir);
  const modelSerial = (files[0] && await readModelSerialAtAsync(files[0], 0x1e)) || "Unknown";

  const sessions = [];
  for (const file of files) {
    try {
      const session = parseFormatASession(await fs.promises.readFile(file));
      if (session) sessions.push(session);
    } catch { /* skip malformed */ }
  }
  return { deviceInfo: defaultDeviceInfo(modelSerial), sessions };
}
function parseFormatASession(data) {
  if (data.length < 0x33) return null;
  const cur = new Cursor(data);
  const start = [cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
  const finish = [cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
  const mode = cur.u8();
  cur.skip(5); // ramp, init, min, max, skip1
  cur.skip(1); // humidity
  cur.skip(7);
  cur.skip(1); // avg_leak
  cur.skip(1); // skip2
  cur.skip(1); // avg_pressure (header copy; we use per-minute below)
  cur.skip(1); // skip3
  cur.skip(16); // model/serial
  const recordCount = cur.i16();
  cur.skip(3);

  const startTs = yuwellTs(start[0], start[1], start[2], start[3], start[4], start[5]);
  const finishTs = yuwellTs(finish[0], finish[1], finish[2], finish[3], finish[4], finish[5]);
  if (startTs == null || finishTs == null) return null;

  let oa = 0, hi = 0, ca = 0, pSum = 0, minutes = 0;
  for (let i = 0; i < Math.max(0, recordCount); i++) {
    if (cur.remaining < 10) break;
    const pressure = cur.u8();
    cur.skip(2);
    oa += cur.u8();
    hi += cur.u8();
    ca += cur.u8();
    cur.skip(3);
    cur.u8(); // leak volume
    pSum += pressure / 10;
    minutes += 1;
  }

  return {
    date: dateStringUTC(startTs),
    usageHours: computeUsageHours(startTs, finishTs),
    oa, hi, ca,
    avgPressure: minutes > 0 ? pSum / minutes : null,
    mode
  };
}

// ── Format B ─────────────────────────────────────────────────────────────────
function isFormatB(root) {
  const p = path.join(root, "YHSD-NEW.BYS");
  try {
    return fs.statSync(p).isFile() && fs.statSync(p).size === 0x10000;
  } catch {
    return false;
  }
}
async function isFormatBAsync(root) {
  const p = path.join(root, "YHSD-NEW.BYS");
  try {
    const stat = await fs.promises.stat(p);
    return stat.isFile() && stat.size === 0x10000;
  } catch {
    return false;
  }
}
async function parseFormatBAsync(root) {
  let data;
  try {
    data = await fs.promises.readFile(path.join(root, "YHSD-NEW.BYS"));
  } catch {
    return null;
  }
  return parseFormatBBuffer(data);
}

function parseFormatBBuffer(data) {
  if (data.length !== 0x10000) return null;

  const cur = new Cursor(data);
  cur.skip(4); // magic
  cur.skip(8); // mode, ramp, init, press_set, max, min, humidity, fps
  cur.skip(19);
  const recordCount = cur.i16();
  cur.skip(99);
  const modelSerial = asciiTrimmed(cur, 16);
  cur.skip(2924); // jump to 0xC00

  const sessions = [];
  for (let i = 0; i < Math.max(0, recordCount); i++) {
    if (cur.remaining < 30) break;
    const start = [cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
    const finish = [cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
    const sessMode = cur.u8();
    cur.skip(7); // ramp, init, press_set, max, min, humidity, fps
    const oaiCount = cur.u8();
    const hiCount = cur.u8();
    cur.skip(2);
    cur.u8(); // avg_leak
    cur.u8(); // avg_press
    const offsetHigh = cur.u8();
    const offsetLow = cur.u8();
    cur.skip(1);
    const sessionMinutes = cur.u8();

    const startTs = yuwellTs(start[0], start[1], start[2], start[3], start[4], start[5]);
    const finishTs = yuwellTs(finish[0], finish[1], finish[2], finish[3], finish[4], finish[5]);
    if (startTs == null || finishTs == null) continue;

    let oa = oaiCount, hi = hiCount, ca = 0;
    const dataOffset = ((offsetHigh << 8) | offsetLow) + 0x7600;
    const mins = sessionMinutes;
    if (dataOffset + mins * 7 <= data.length) {
      for (let m = 0; m < mins; m++) {
        const base = dataOffset + m * 7;
        const leakage = data[base];
        if (m === 0 && leakage !== 0xf9) break; // valid-data sentinel
        if (m > 0) {
          oa += data[base + 3];
          hi += data[base + 4];
          ca += data[base + 6];
        }
      }
    }

    sessions.push({
      date: dateStringUTC(startTs),
      usageHours: sessionMinutes / 60,
      oa, hi, ca,
      avgPressure: null,
      mode: sessMode
    });
  }

  return { deviceInfo: defaultDeviceInfo(modelSerial), sessions };
}

// ── Format C ─────────────────────────────────────────────────────────────────
async function detectFormatCAsync(root) {
  const yhDirs = await findYhDirsAsync(root);
  for (const { dir } of yhDirs) {
    const files = await bysFilesInAsync(dir);
    if (files.length > 0 && await readModelSerialAtAsync(files[0], 0x27) != null) {
      return true;
    }
  }
  return false;
}
async function parseFormatCAsync(root) {
  const yhDirs = await findYhDirsAsync(root);
  if (!yhDirs.length) return null;
  const files = await bysFilesInAsync(yhDirs[0].dir);
  const modelSerial = (files[0] && await readModelSerialAtAsync(files[0], 0x27)) || "Unknown";

  const sessions = [];
  for (const file of files) {
    try {
      const session = parseFormatCSession(await fs.promises.readFile(file));
      if (session) sessions.push(session);
    } catch { /* skip malformed */ }
  }
  return { deviceInfo: defaultDeviceInfo(modelSerial), sessions };
}
function parseFormatCSession(data) {
  if (data.length < 0x3c) return null;
  const cur = new Cursor(data);
  const startYear = cur.i16();
  const start = [startYear, cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
  const finishYear = cur.i16();
  const finish = [finishYear, cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
  const recordCount = cur.i16(); // offset 0x0E
  cur.skip(5);
  cur.u8(); // humidity
  cur.skip(17);
  cur.skip(16); // model/serial (also read directly at offset 0x27)
  cur.skip(5); // header remainder → 0x3C

  const startTs = makeTs(start[0], start[1], start[2], start[3], start[4], start[5]);
  const finishTs = makeTs(finish[0], finish[1], finish[2], finish[3], finish[4], finish[5]);
  if (startTs == null || finishTs == null) return null;

  let oa = 0, hi = 0, ca = 0, pSum = 0, minutes = 0, detectedMode = 1;
  for (let i = 0; i < Math.max(0, recordCount); i++) {
    if (cur.remaining < 0x28) break;
    cur.skip(1); // 0xF9 marker
    const modeRec = cur.u8();
    cur.skip(10);
    const pressure = cur.u8();
    cur.u8(); // init
    cur.skip(4);
    cur.u8(); // ramp
    cur.skip(2);
    cur.i16(); // tidal volume
    cur.u8(); // leak vol
    cur.skip(1);
    cur.u8(); // minute vol
    cur.skip(5);
    cur.u8(); // insp ratio
    cur.skip(2);
    cur.u8(); // resp rate
    oa += cur.u8();
    hi += cur.u8();
    cur.skip(1);
    ca += cur.u8();
    cur.skip(1);

    if (minutes === 0) detectedMode = modeRec;
    pSum += pressure / 10;
    minutes += 1;
  }

  return {
    date: dateStringUTC(startTs),
    usageHours: computeUsageHours(startTs, finishTs),
    oa, hi, ca,
    avgPressure: minutes > 0 ? pSum / minutes : null,
    mode: detectedMode
  };
}

// ── Format D ─────────────────────────────────────────────────────────────────
async function detectFormatDAsync(root) {
  const yhDirs = await findYhDirsAsync(root);
  for (const { dir } of yhDirs) {
    if (fs.existsSync(path.join(dir, "RunLog.bys")) && await hasSubdirAsync(dir)) {
      return true;
    }
  }
  return false;
}
async function parseFormatDAsync(root) {
  const yhDirs = await findYhDirsAsync(root);
  if (!yhDirs.length) return null;
  const { name: dirName, dir: yhPath } = yhDirs[0];
  let modelSerial = dirName;

  let sessDirs;
  try {
    sessDirs = (await fs.promises.readdir(yhPath, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => path.join(yhPath, e.name))
      .sort();
  } catch {
    return null;
  }

  const sessions = [];
  for (const sessDir of sessDirs) {
    const parsed = await parseFormatDSessionAsync(sessDir);
    if (parsed) {
      if (parsed.modelSerial && parsed.modelSerial !== "Unknown") modelSerial = parsed.modelSerial;
      sessions.push(parsed.session);
    }
  }
  return { deviceInfo: defaultDeviceInfo(modelSerial), sessions };
}
async function findFileWithSuffixAsync(dir, suffix) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return null;
  }
  const sfx = suffix.toUpperCase();
  const match = entries.find(name => name.toUpperCase().endsWith(sfx));
  return match ? path.join(dir, match) : null;
}
async function parseFormatDSessionAsync(sessDir) {
  const sFile = await findFileWithSuffixAsync(sessDir, "s.bys");
  if (!sFile) return null;
  let sData;
  try {
    sData = await fs.promises.readFile(sFile);
  } catch {
    return null;
  }
  return parseFormatDSessionBufferAsyncMinute(sessDir, sData);
}

async function parseFormatDSessionBufferAsyncMinute(sessDir, sData) {
  const parsed = parseFormatDSessionHeader(sData);
  if (!parsed) return null;
  const { modelSerial, startTs, finishTs, mode } = parsed;

  let oa = 0, hi = 0, ca = 0, pSum = 0, minutes = 0;
  const mFile = await findFileWithSuffixAsync(sessDir, "m.bys");
  if (mFile) {
    try {
      const minuteStats = parseFormatDMinuteData(await fs.promises.readFile(mFile));
      oa = minuteStats.oa;
      hi = minuteStats.hi;
      ca = minuteStats.ca;
      pSum = minuteStats.pSum;
      minutes = minuteStats.minutes;
    } catch { /* per-minute optional */ }
  }

  return {
    modelSerial,
    session: {
      date: dateStringUTC(startTs),
      usageHours: computeUsageHours(startTs, finishTs),
      oa, hi, ca,
      avgPressure: minutes > 0 ? pSum / minutes : null,
      mode
    }
  };
}

function parseFormatDSessionHeader(sData) {
  if (sData.length < 0x4d) return null;

  let modelSerial, startTs, finishTs, mode;
  try {
    const cur = new Cursor(sData);
    cur.skip(2);
    const start = [cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
    const finish = [cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8(), cur.u8()];
    cur.skip(18);
    modelSerial = asciiTrimmed(cur, 16);
    cur.skip(8);
    mode = cur.u8();
    cur.skip(18);
    cur.u8(); // fps level
    cur.u8(); // ramp
    startTs = yuwellTs(start[0], start[1], start[2], start[3], start[4], start[5]);
    finishTs = yuwellTs(finish[0], finish[1], finish[2], finish[3], finish[4], finish[5]);
  } catch {
    return null;
  }
  if (startTs == null || finishTs == null) return null;
  return { modelSerial, startTs, finishTs, mode };
}

function parseFormatDMinuteData(mData) {
  let oa = 0, hi = 0, ca = 0, pSum = 0, minutes = 0;
  if (mData.length >= 0x08) {
    const mc = new Cursor(mData);
    mc.skip(6);
    const recordCount = mc.i16();
    for (let i = 0; i < Math.max(0, recordCount); i++) {
      if (mc.remaining < 19) break;
      const pressure = mc.u8();
      mc.skip(1);
      oa += mc.u8();
      ca += mc.u8();
      hi += mc.u8();
      mc.skip(4);
      mc.u8(); // leakage
      mc.skip(5);
      mc.u8(); // spo2
      mc.u8(); // pulse
      mc.skip(2);
      pSum += pressure / 10;
      minutes += 1;
    }
  }
  return { oa, hi, ca, pSum, minutes };
}

module.exports = {
  YuwellLoader,
  parseFormatASession,
  parseFormatCSession,
  aggregateSessions
};
