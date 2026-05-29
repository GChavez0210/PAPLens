"use strict";

// Apex Medical loader (XT / XT Auto / iCH / Spirit series).
//
// SD card layout:
//   APDATA/INFO.APC         – device identity (64-byte record)
//   APDATA/<YYYYMMDD>.APC    – per-day session file
//                              (16-byte header + N × 48-byte session records)
//
// Derived from open-cpap cpap-parser (GPL-3.0-or-later) src/parsers/apex.rs,
// which ports OSCAR's ApexLoader.cpp.  Summary-level: usage, set/percentile
// pressure, therapy mode, per-day AHI/OAI/CAI/HI, leak P50/P95, snore index,
// and flow-limitation index.  See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");

const APDATA = "APDATA";
const INFO_FILE = "INFO.APC";
// Seconds between the Unix epoch (1970-01-01) and the Apex epoch (2000-01-01).
const APEX_EPOCH_OFFSET = 946_684_800;
const APC_MAGIC = [0x41, 0x50, 0x43, 0x00]; // "APC\0"
const INFO_MAGIC = [0x41, 0x50]; // "AP"
const FILE_HEADER_SIZE = 16;
const RECORD_SIZE = 0x30; // 48 bytes

const MODE_LABELS = { 0: "CPAP", 1: "APAP", 2: "BiLevel" };

class ApexLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "Apex Medical";
  }

  getDeviceCapabilities() {
    return {
      ...super.getDeviceCapabilities(),
      supportsAHI: true,
      supportsLeakPercentiles: true,
      supportsPressurePercentiles: true,
      supportsFlowLimitation: true
    };
  }

  static detect(sdCardPath) {
    const apdata = path.join(sdCardPath, APDATA);
    let entries;
    try {
      entries = fs.readdirSync(apdata);
    } catch {
      return false;
    }
    return entries.some(name => /\.APC$/i.test(name) && !/^INFO\.APC$/i.test(name));
  }

  async loadAll(onProgress) {
    const apdata = path.join(this.dataPath, APDATA);

    this.deviceInfo = this._readDeviceInfo(path.join(apdata, INFO_FILE));

    let files;
    try {
      files = fs.readdirSync(apdata)
        .filter(name => /\.APC$/i.test(name) && !/^INFO\.APC$/i.test(name))
        .sort();
    } catch {
      files = [];
    }

    const dayMap = new Map();
    const sessions = [];
    for (const name of files) {
      let buf;
      try {
        buf = fs.readFileSync(path.join(apdata, name));
      } catch {
        continue;
      }
      parseApcFile(buf, dayMap, sessions);
    }

    this.sessions = sessions.sort((a, b) => a.begin - b.begin);
    const dailyStats = buildDailyStats(dayMap, (date) => this.blankDay(date));
    if (onProgress) onProgress({ done: dailyStats.length, total: dailyStats.length });
    return this.buildSummary(this.deviceInfo, dailyStats);
  }

  _readDeviceInfo(infoPath) {
    try {
      return parseInfo(fs.readFileSync(infoPath));
    } catch {
      return {
        serialNumber: "Unknown",
        productName: "Apex Medical",
        productCode: "APEX",
        machineId: "Unknown",
        firmwareVersion: "Unknown"
      };
    }
  }
}

function parseInfo(buf) {
  if (buf.length < 36 || buf[0] !== INFO_MAGIC[0] || buf[1] !== INFO_MAGIC[1]) {
    return {
      serialNumber: "Unknown",
      productName: "Apex Medical",
      productCode: "APEX",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
  }
  const model = asciiField(buf, 0x02, 16);
  const serial = asciiField(buf, 0x12, 12);
  const firmware = asciiField(buf, 0x1e, 6);
  return {
    serialNumber: serial || "Unknown",
    productName: model || "Apex Medical",
    productCode: "APEX",
    machineId: "Unknown",
    firmwareVersion: firmware || "Unknown"
  };
}

// Parse one <YYYYMMDD>.APC file: accumulates records into dayMap keyed by the
// file's header date token, and pushes session spans for the waveform list.
function parseApcFile(buf, dayMap, sessions) {
  if (buf.length < FILE_HEADER_SIZE) return;
  for (let i = 0; i < APC_MAGIC.length; i++) {
    if (buf[i] !== APC_MAGIC[i]) return;
  }
  const dateToken = buf.readUInt32LE(0x04);
  const recordCount = buf.readUInt16LE(0x08);
  const year = (dateToken >>> 9) + 2000;
  const month = (dateToken >>> 5) & 0x0f;
  const day = dateToken & 0x1f;
  if (!month || !day) return;
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  let acc = dayMap.get(date);
  if (!acc) {
    acc = newAccumulator(date);
    dayMap.set(date, acc);
  }

  for (let r = 0; r < recordCount; r++) {
    const off = FILE_HEADER_SIZE + r * RECORD_SIZE;
    if (off + RECORD_SIZE > buf.length) break;

    const startOffset = buf.readUInt32LE(off);
    const durationMinutes = buf.readUInt16LE(off + 0x04);
    const mode = buf[off + 0x06];
    const p50 = buf[off + 0x09] / 10;
    const p95 = buf[off + 0x0b] / 10;
    const oa = buf.readUInt16LE(off + 0x0c);
    const hi = buf.readUInt16LE(off + 0x0e);
    const ca = buf.readUInt16LE(off + 0x10);
    const leak50 = buf[off + 0x12];
    const leak95 = buf[off + 0x13];
    const snore = buf[off + 0x15] / 10;
    const flowLim = buf[off + 0x16] / 10;

    const usageHours = durationMinutes / 60;
    if (usageHours <= 0) continue;

    const startMs = (APEX_EPOCH_OFFSET + startOffset) * 1000;
    sessions.push({
      begin: startMs,
      end: startMs + durationMinutes * 60 * 1000,
      fileType: `APEX-${MODE_LABELS[mode] || "Unknown"}`
    });

    acc.usageHours += usageHours;
    acc.oa += oa;
    acc.hi += hi;
    acc.ca += ca;
    acc.p50 += p50 * usageHours;
    acc.p95 += p95 * usageHours;
    acc.leak50 += leak50 * usageHours;
    acc.leak95 += leak95 * usageHours;
    acc.snore += snore * usageHours;
    acc.flowLim += flowLim * usageHours;
    if (usageHours > acc.dominantHours) {
      acc.dominantHours = usageHours;
      acc.dominantMode = mode;
    }
  }
}

function newAccumulator(date) {
  return {
    date, usageHours: 0, oa: 0, hi: 0, ca: 0,
    p50: 0, p95: 0, leak50: 0, leak95: 0, snore: 0, flowLim: 0,
    dominantHours: 0, dominantMode: 0
  };
}

function buildDailyStats(dayMap, makeBlankDay) {
  const dailyStats = [];
  for (const acc of dayMap.values()) {
    const h = acc.usageHours;
    if (h <= 0) continue;

    const day = makeBlankDay(acc.date);
    day.usageHours = h;
    day.onDuration = h * 60;
    day.pressure = acc.p50 / h;
    day.maxPressure = acc.p95 / h;
    day.leak50 = acc.leak50 / h;
    day.leak95 = acc.leak95 / h;
    day.snoreIndex = acc.snore / h;
    day.flowLimP95 = acc.flowLim / h;
    day.raw.pressureMode = MODE_LABELS[acc.dominantMode] || "CPAP";

    const oai = acc.oa / h;
    const cai = acc.ca / h;
    const hiIdx = acc.hi / h;
    day.oai = oai;
    day.cai = cai;
    day.hi = hiIdx;
    day.ai = oai + cai;
    day.ahi = oai + cai + hiIdx;

    dailyStats.push(day);
  }
  return dailyStats.sort((a, b) => a.date.localeCompare(b.date));
}

function asciiField(buf, offset, len) {
  const end = Math.min(offset + len, buf.length);
  let str = "";
  for (let i = offset; i < end; i++) {
    if (buf[i] === 0) break;
    str += String.fromCharCode(buf[i]);
  }
  return str.trim();
}

module.exports = { ApexLoader, parseInfo, parseApcFile, buildDailyStats };
