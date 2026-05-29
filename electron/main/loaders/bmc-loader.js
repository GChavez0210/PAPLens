"use strict";

// BMC / 3B Medical RESmart loader.
//
// SD card layout (all multi-byte integers little-endian):
//   <serial>.USR  – main data file: device identity + historic sessions
//   <serial>.idx  – 512-byte index packets (machine settings)
//   <serial>.000… – 256-byte waveform packets (not decoded)
//
// Derived from open-cpap cpap-parser (GPL-3.0-or-later) src/parsers/bmc.rs,
// which ports OSCAR's bmc_loader.cpp / bmcDataParsing.cpp.
//
// Summary-level only: device info plus per-day usage and respiratory-event
// indices (AHI/OAI/CAI/HI) reconstructed from the historic-session records.
// Pressure and leak live in the undecoded waveform/settings packets and are
// not reported.  See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");

const SESSION_MARKER = 0xe1;
const SESSIONS_START_OFFSET = 0x102340;
const SERIAL_OFFSET = 0x2d;
const MODEL_OFFSET = 0x2296;
const ID_FIELD_LEN = 32;

// data-message types carrying 24-bit respiratory events
const EVENT_TYPES = {
  0x83: "obstructive",
  0x84: "hypopnea",
  0x87: "central"
};

class BmcLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "BMC";
  }

  getDeviceCapabilities() {
    return {
      ...super.getDeviceCapabilities(),
      supportsAHI: true
    };
  }

  static detect(sdCardPath) {
    const usr = findUsrFile(sdCardPath);
    if (!usr) return false;
    const stem = usr.slice(0, usr.length - path.extname(usr).length);
    return fs.existsSync(stem + ".idx") && fs.existsSync(stem + ".000");
  }

  async loadAll(onProgress) {
    const usrPath = findUsrFile(this.dataPath);
    if (!usrPath) {
      this.deviceInfo = this._defaultDeviceInfo();
      return this.buildSummary(this.deviceInfo, []);
    }

    let buf;
    try {
      buf = fs.readFileSync(usrPath);
    } catch {
      this.deviceInfo = this._defaultDeviceInfo();
      return this.buildSummary(this.deviceInfo, []);
    }

    this.deviceInfo = parseDeviceInfo(buf);
    const dayMap = parseHistoricSessions(buf);
    const dailyStats = buildDailyStats(dayMap, (date) => this.blankDay(date));

    if (onProgress) onProgress({ done: dailyStats.length, total: dailyStats.length });
    return this.buildSummary(this.deviceInfo, dailyStats);
  }

  _defaultDeviceInfo() {
    return {
      serialNumber: "Unknown",
      productName: "RESmart",
      productCode: "BMC",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
  }
}

function findUsrFile(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const match = entries.find(name => /\.USR$/i.test(name));
  return match ? path.join(dir, match) : null;
}

function parseDeviceInfo(buf) {
  const serial = asciiField(buf, SERIAL_OFFSET, ID_FIELD_LEN);
  const model = asciiField(buf, MODEL_OFFSET, ID_FIELD_LEN);
  return {
    serialNumber: serial || "Unknown",
    productName: model || "RESmart",
    productCode: "BMC",
    machineId: "Unknown",
    firmwareVersion: "Unknown"
  };
}

// Walk the historic-session chain starting at SESSIONS_START_OFFSET and
// accumulate per-day usage minutes and event counts.
function parseHistoricSessions(buf) {
  const dayMap = new Map();
  const fileSize = buf.length;
  let offset = SESSIONS_START_OFFSET;

  while (offset < fileSize) {
    if (buf[offset] !== SESSION_MARKER) break;
    if (offset + 5 > fileSize) break;

    const next = buf.readUInt32LE(offset + 1);
    let sliceEnd;
    if (next === 0 || next === 0xffffffff || next <= offset || next > fileSize) {
      sliceEnd = fileSize;
    } else {
      sliceEnd = next;
    }

    const session = parseHistoricSession(buf.slice(offset, sliceEnd));
    if (session && session.durationMinutes > 0) {
      let acc = dayMap.get(session.date);
      if (!acc) {
        acc = { date: session.date, usageMinutes: 0, obstructive: 0, central: 0, hypopnea: 0 };
        dayMap.set(session.date, acc);
      }
      acc.usageMinutes += session.durationMinutes;
      acc.obstructive += session.counts.obstructive;
      acc.central += session.counts.central;
      acc.hypopnea += session.counts.hypopnea;
    }

    if (sliceEnd <= offset) break;
    offset = sliceEnd;
  }

  return dayMap;
}

function parseHistoricSession(raw) {
  if (raw.length < 0x11 || raw[0] !== SESSION_MARKER) return null;

  const startEncoded = raw.readUInt16LE(0x07);
  const date = decodeEncodedDate(startEncoded);
  if (!date) return null;

  const durationMinutes = raw.readUInt16LE(0x0f);

  const counts = { obstructive: 0, central: 0, hypopnea: 0 };

  // Skip the fixed message block at 0x45: pairs of (u8 type, u32 value) until 0xFF.
  let pos = 0x45;
  while (pos + 5 <= raw.length) {
    const b = raw[pos];
    pos += 5;
    if (b === 0xff) break;
  }

  // Data messages: u8 type, u16 count, u16 discard, then count entries whose
  // width depends on type (32-bit, 24-bit event, or 16-bit).
  while (pos + 5 <= raw.length) {
    const msgType = raw[pos];
    const count = raw.readUInt16LE(pos + 1);
    pos += 5; // type(1) + count(2) + discard(2)

    const category = EVENT_TYPES[msgType];
    if (msgType === 0x82 || msgType === 0x86) {
      pos += count * 4;
    } else if (category) {
      for (let i = 0; i < count; i++) {
        if (pos + 3 > raw.length) break;
        counts[category] += 1;
        pos += 3;
      }
    } else {
      pos += count * 2;
    }
    if (count === 0 && !category) break; // avoid stalling on a zero-length unknown message
  }

  return { date, durationMinutes, counts };
}

function decodeEncodedDate(encoded) {
  const year = 2000 + (encoded >> 9);
  const month = (encoded >> 5) & 0x0f;
  const day = encoded & 0x1f;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildDailyStats(dayMap, makeBlankDay) {
  const dailyStats = [];
  for (const acc of dayMap.values()) {
    const usageHours = acc.usageMinutes / 60;
    if (usageHours <= 0) continue;

    const day = makeBlankDay(acc.date);
    day.usageHours = usageHours;
    day.onDuration = acc.usageMinutes;

    const oai = acc.obstructive / usageHours;
    const cai = acc.central / usageHours;
    const hiIdx = acc.hypopnea / usageHours;
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
  if (offset >= buf.length) return "";
  const end = Math.min(offset + len, buf.length);
  let str = "";
  for (let i = offset; i < end; i++) {
    if (buf[i] === 0) break;
    str += String.fromCharCode(buf[i]);
  }
  return str.replace(/[\0 ]+$/g, "").trim();
}

module.exports = {
  BmcLoader,
  parseDeviceInfo,
  parseHistoricSession,
  parseHistoricSessions,
  decodeEncodedDate
};
