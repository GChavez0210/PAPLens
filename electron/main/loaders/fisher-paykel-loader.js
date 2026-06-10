"use strict";

// Fisher & Paykel SleepStyle / ICON loader
//
// SD card layout:
//   FPHCARE/ICON/<serial>/SUM*.fph
//
// SUM*.fph:
//   512-byte text header followed by 40-byte binary session records.
//
// Derived from open-cpap cpap-parser (GPL-3.0-or-later)
// src/parsers/fisher_paykel.rs, which ports OSCAR sleepstyle_loader.cpp.
// See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");

const HEADER_SIZE = 0x200;
const RECORD_SIZE = 40;

class FisherPaykelLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "Fisher & Paykel";
  }

  getDeviceCapabilities() {
    return {
      ...super.getDeviceCapabilities(),
      supportsPressurePercentiles: true
    };
  }

  static detect(sdCardPath) {
    const iconPath = path.join(sdCardPath, "FPHCARE", "ICON");
    if (!fs.existsSync(iconPath)) return false;
    try {
      return fs.readdirSync(iconPath, { withFileTypes: true })
        .some(entry => entry.isDirectory() && hasSumFile(path.join(iconPath, entry.name)));
    } catch {
      return false;
    }
  }

  async loadAll(onProgress) {
    const machines = await findSleepStyleMachines(path.join(this.dataPath, "FPHCARE", "ICON"));
    if (!machines.length) {
      this.deviceInfo = this._defaultDeviceInfo("Unknown");
      return this.buildSummary(this.deviceInfo, []);
    }

    const machine = machines[0];
    let modelInfo = { model: "SleepStyle", productCode: "FPH_SLEEPSTYLE" };
    const dailyMap = new Map();
    const sessions = [];

    let sumFiles;
    try {
      sumFiles = (await fs.promises.readdir(machine.machinePath))
        .filter(name => /^SUM.*\.FPH$/i.test(name))
        .sort()
        .map(name => path.join(machine.machinePath, name));
    } catch {
      sumFiles = [];
    }

    for (const filePath of sumFiles) {
      try {
        const buf = await fs.promises.readFile(filePath);
        if (buf.length < HEADER_SIZE) continue;
        const info = parseSumHeader(buf.slice(0, HEADER_SIZE));
        if (info.productCode) modelInfo = info;
        for (const session of parseSumSessions(buf.slice(HEADER_SIZE))) {
          sessions.push({
            begin: session.startMs,
            end: session.startMs + session.usageSeconds * 1000,
            fileType: "FPH-SUM"
          });
          this._addSessionToDailyMap(dailyMap, session);
        }
      } catch {
        // Skip unreadable or malformed summary files.
      }
    }

    this.sessions = sessions.sort((a, b) => a.begin - b.begin);
    this.deviceInfo = {
      serialNumber: machine.serial,
      productName: modelInfo.model,
      productCode: modelInfo.productCode || "FPH_SLEEPSTYLE",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };

    const dailyStats = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (onProgress) onProgress({ done: dailyStats.length, total: dailyStats.length });
    return this.buildSummary(this.deviceInfo, dailyStats);
  }

  _defaultDeviceInfo(serialNumber) {
    return {
      serialNumber,
      productName: "SleepStyle",
      productCode: "FPH_SLEEPSTYLE",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
  }

  _addSessionToDailyMap(dailyMap, session) {
    const date = localDateString(new Date(session.startMs));
    if (!dailyMap.has(date)) {
      const day = this.blankDay(date);
      day.ahi = null; day.ai = null; day.hi = null;
      day.oai = null; day.cai = null; day.uai = null;
      day.pressure = 0;
      day.maxPressure = 0;
      dailyMap.set(date, day);
    }

    const day = dailyMap.get(date);
    const prevHours = day.usageHours;
    const usageHours = session.usageSeconds / 3600;
    const totalHours = prevHours + usageHours;
    if (totalHours <= 0) return;

    day.pressure = weighted(day.pressure, prevHours, session.minPressure, usageHours, totalHours);
    day.maxPressure = weighted(day.maxPressure, prevHours, session.pressure95, usageHours, totalHours);
    day.usageHours = totalHours;
    day.onDuration += usageHours * 60;
    day.raw.pressureMode = session.pressureMode;
  }
}

function hasSumFile(machinePath) {
  try {
    return fs.readdirSync(machinePath).some(name => /^SUM.*\.FPH$/i.test(name));
  } catch {
    return false;
  }
}

async function findSleepStyleMachines(iconPath) {
  const result = [];
  let entries;
  try {
    entries = await fs.promises.readdir(iconPath, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const machinePath = path.join(iconPath, entry.name);
    let files;
    try {
      files = (await fs.promises.readdir(machinePath)).filter(name => /^SUM.*\.FPH$/i.test(name));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const buf = await fs.promises.readFile(path.join(machinePath, file));
        if (isSleepStyleSumFile(buf)) {
          result.push({ serial: entry.name, machinePath });
          break;
        }
      } catch {
        // Try the next file.
      }
    }
  }
  return result;
}

function isSleepStyleSumFile(buf) {
  const textRegion = buf.slice(0, Math.min(buf.length, HEADER_SIZE));
  const lines = [];
  let current = [];
  for (const byte of textRegion) {
    if (byte === 0x3b) break; // ;
    if (byte === 0x0d || byte === 0x0a) {
      if (current.length) {
        lines.push(Buffer.from(current).toString("ascii").trim());
        current = [];
      }
    } else {
      current.push(byte);
    }
  }
  return (lines[4] || "").toUpperCase() === "SLEEPSTYLE";
}

function parseSumHeader(header) {
  const tokens = header.toString("ascii").split(/\s+/).filter(Boolean);
  const modelName = tokens[4] || "SleepStyle";
  const productCode = tokens[5] || "FPH_SLEEPSTYLE";
  const modeChar = productCode[3];
  const modeSuffix = modeChar ? (modeChar === "C" ? " CPAP" : " Auto") : "";
  return {
    model: `${modelName}${modeSuffix}`,
    productCode
  };
}

function parseSumSessions(buf) {
  const sessions = [];
  for (let off = 0; off + RECORD_SIZE <= buf.length; off += RECORD_SIZE) {
    const tsRaw = buf.readUInt32LE(off);
    if (tsRaw === 0xffffffff || (tsRaw & 0xffff) === 0xfafe) break;
    const startMs = decodeFpTimestamp(tsRaw);
    if (startMs == null) continue;

    const useTime = buf[off + 5];
    const minPressureSeen = buf[off + 6];
    const pct95PressureSeen = buf[off + 7];
    const maxPressureSeen = buf[off + 8];
    const cpapPressureSet = buf[off + 26];
    const isCpap = maxPressureSeen === cpapPressureSet && pct95PressureSeen === cpapPressureSet;

    sessions.push({
      startMs,
      usageSeconds: useTime * 360,
      minPressure: minPressureSeen / 10,
      pressure95: pct95PressureSeen / 10,
      pressureMode: isCpap ? "CPAP" : "APAP"
    });
  }
  return sessions;
}

function decodeFpTimestamp(raw) {
  const day = raw & 0x1f;
  const month = (raw >>> 5) & 0x0f;
  const year = 2000 + ((raw >>> 9) & 0x3f);
  const ts2 = raw >>> 15;
  const second = ts2 & 0x3f;
  const minute = (ts2 >> 6) & 0x3f;
  const hour = ts2 >> 12;
  if (!month || !day || hour > 23 || minute > 59 || second > 59) return null;

  const ms = Date.UTC(year, month - 1, day, hour, minute, second) - 54_000;
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weighted(prev, prevWeight, next, nextWeight, totalWeight) {
  return ((prev || 0) * prevWeight + next * nextWeight) / totalWeight;
}

module.exports = { FisherPaykelLoader, decodeFpTimestamp, parseSumSessions };
