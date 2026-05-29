"use strict";

// Lowenstein Medical / Weinmann loader
//
// Supported layout:
//   WM_DATA.TDF at SD-card root.
//
// Derived from open-cpap cpap-parser (GPL-3.0-or-later)
// src/parsers/lowenstein.rs, which ports OSCAR weinmann_loader.cpp.
// See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");

const WM_MAGIC = Buffer.from([0x57, 0x4d, 0x01, 0x00]);
const FILE_HEADER_SIZE = 32;
const BLOCK_HEADER_SIZE = 6;
const SESSION_RECORD_SIZE = 34;
const RECORD_TYPE_SESSION = 0x01;
const RECORD_TYPE_EOF = 0xff;

class LowensteinLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "Lowenstein Medical";
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
    return fs.existsSync(path.join(sdCardPath, "WM_DATA.TDF"));
  }

  async loadAll(onProgress) {
    let parsed;
    try {
      parsed = parseWmData(fs.readFileSync(path.join(this.dataPath, "WM_DATA.TDF")));
    } catch {
      this.deviceInfo = this._defaultDeviceInfo();
      return this.buildSummary(this.deviceInfo, []);
    }

    this.deviceInfo = {
      serialNumber: parsed.machine.serialNumber || "Unknown",
      productName: parsed.machine.model || "Lowenstein Medical",
      productCode: parsed.machine.productCode || "WM",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
    this.sessions = parsed.sessions;

    if (onProgress) onProgress({ done: parsed.dailyStats.length, total: parsed.dailyStats.length });
    return this.buildSummary(this.deviceInfo, parsed.dailyStats);
  }

  _defaultDeviceInfo() {
    return {
      serialNumber: "Unknown",
      productName: "Lowenstein Medical",
      productCode: "WM",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
  }
}

function parseWmData(buf) {
  if (buf.length < FILE_HEADER_SIZE) {
    throw new Error(`WM_DATA.TDF too short: ${buf.length} bytes`);
  }
  if (!buf.slice(0, 4).equals(WM_MAGIC)) {
    throw new Error("WM_DATA.TDF bad magic");
  }

  const machine = {
    model: readAsciiField(buf, 4, 16),
    serialNumber: readAsciiField(buf, 20, 12),
    productCode: "WM"
  };

  const dailyMap = new Map();
  const sessions = [];
  let off = FILE_HEADER_SIZE;

  while (off + BLOCK_HEADER_SIZE <= buf.length) {
    const recordType = buf[off];
    const blockLength = buf.readUInt16LE(off + 2);
    if (recordType === RECORD_TYPE_EOF) break;
    if (blockLength < BLOCK_HEADER_SIZE) break;

    const payloadStart = off + BLOCK_HEADER_SIZE;
    const payloadLength = blockLength - BLOCK_HEADER_SIZE;
    if (
      recordType === RECORD_TYPE_SESSION &&
      payloadLength >= SESSION_RECORD_SIZE &&
      payloadStart + SESSION_RECORD_SIZE <= buf.length
    ) {
      const parsed = parseSessionRecord(buf, payloadStart);
      if (parsed) {
        sessions.push(parsed.session);
        mergeDay(dailyMap, parsed.day);
      }
    }

    off += blockLength;
  }

  return {
    machine,
    sessions: sessions.sort((a, b) => a.begin - b.begin),
    dailyStats: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  };
}

function parseSessionRecord(buf, off) {
  const year = buf.readUInt16LE(off);
  const month = buf[off + 2];
  const dayOfMonth = buf[off + 3];
  const secondsSinceMidnight = buf.readUInt32LE(off + 4);
  const durationMinutes = buf.readUInt16LE(off + 8);
  const modeByte = buf[off + 10];
  const pressure50 = buf[off + 13] / 10;
  const pressure95 = buf[off + 14] / 10;
  const ahi = buf.readUInt16LE(off + 15) / 10;
  const oai = buf.readUInt16LE(off + 17) / 10;
  const cai = buf.readUInt16LE(off + 19) / 10;
  const hi = buf.readUInt16LE(off + 21) / 10;
  const leak50 = buf[off + 23];
  const leak95 = buf[off + 24];
  const snoreIndex = buf[off + 26] / 10;
  const flowLimitation = buf[off + 27] / 10;

  const startMs = Date.UTC(year, month - 1, dayOfMonth, 0, 0, secondsSinceMidnight);
  if (!Number.isFinite(startMs) || month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }
  const endMs = startMs + durationMinutes * 60_000;
  const date = `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
  const pressureMode = modeByte === 1 ? "APAP" : modeByte === 2 ? "BiLevel" : modeByte === 0 ? "CPAP" : "Unknown";

  const day = {
    date,
    ahi,
    ai: oai + cai,
    hi,
    oai,
    cai,
    uai: 0,
    usageHours: durationMinutes / 60,
    onDuration: durationMinutes,
    pressure: pressure50,
    maxPressure: pressure95,
    leak50,
    leak95,
    leakMax: null,
    flowLimP95: flowLimitation,
    snoreIndex,
    raw: { pressureMode },
    sourceMetrics: {}
  };

  return {
    day,
    session: {
      begin: startMs,
      end: endMs,
      fileType: `WM-${pressureMode}`
    }
  };
}

function mergeDay(dailyMap, incoming) {
  if (!dailyMap.has(incoming.date)) {
    dailyMap.set(incoming.date, {
      ahi: 0, ai: 0, hi: 0, oai: 0, cai: 0, uai: 0,
      rin: null, csr: null, leakSpikeCount: null,
      duration: 0, patientHoursCumulative: 0,
      leakMax: null, pressure: null, maxPressure: null,
      minVent50: null, minVent95: null, tidVol50: null, tidVol95: null,
      respRate50: null, respRate95: null, flowLimP95: null, snoreIndex: null,
      pressureHistogram: null, pressureEfficiency: null,
      eventClusterIndexSource: null, pbEpisodeCount: null, pbTotalSeconds: null,
      pbPct: null, pbAvgCycleSec: null, pbIsSignificant: null,
      spo2Avg: null, pulseAvg: null,
      ...incoming
    });
    return;
  }

  const day = dailyMap.get(incoming.date);
  const prevHours = day.usageHours || 0;
  const nextHours = incoming.usageHours || 0;
  const totalHours = prevHours + nextHours;
  if (totalHours <= 0) return;

  for (const key of ["ahi", "ai", "hi", "oai", "cai", "pressure", "maxPressure", "leak50", "leak95", "flowLimP95", "snoreIndex"]) {
    if (incoming[key] == null) continue;
    day[key] = ((day[key] || 0) * prevHours + incoming[key] * nextHours) / totalHours;
  }
  day.usageHours = totalHours;
  day.onDuration = (day.onDuration || 0) + (incoming.onDuration || 0);
}

function readAsciiField(buf, off, len) {
  const end = off + len;
  let stop = off;
  while (stop < end && buf[stop] !== 0) stop++;
  return buf.slice(off, stop).toString("ascii").trim();
}

module.exports = { LowensteinLoader, parseWmData };
