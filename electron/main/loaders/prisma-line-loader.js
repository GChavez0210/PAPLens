"use strict";

// Löwenstein Prisma Line loader (prisma25 / Eyra and similar).
//
// SD card layout (ZIP containers at the root):
//   config.pcfg   – device identity   (ZIP → mnt/flash/conf/device.xml)
//   therapy.pdat  – daily statistics, per-session events, waveform signals
//                   (ZIP → mnt/flash/data/statistics/statistics_year.bin,
//                          mnt/flash/data/therapy/events/<YYYYMMDD>/event_*.xml)
//
// This is distinct from the WM_DATA.TDF format (see lowenstein-loader.js).
//
// Derived from open-cpap cpap-parser (GPL-3.0-or-later) src/parsers/prisma_line.rs.
// Summary-level only: device info, daily usage/set-pressure/mode, and per-day
// respiratory-event indices. Waveform (wmedf) decoding is not implemented.
// See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");
const { readZipEntries } = require("../parsers/zip-reader");

const CONFIG_FILE = "config.pcfg";
const THERAPY_FILE = "therapy.pdat";
const DEVICE_XML = "mnt/flash/conf/device.xml";
const STATISTICS_BIN = "mnt/flash/data/statistics/statistics_year.bin";
const EVENTS_PREFIX = "mnt/flash/data/therapy/events/";

const MODEL_NAMES = {
  "0x92": "Prisma Smart",
  "0x91": "Prisma Soft",
  "22": "prisma25S",
  "23": "prisma25ST",
  "27": "Löwenstein Eyra"
};

const MODE_LABELS = {
  1: "CPAP", 2: "APAP", 3: "ACSV", 4: "S", 9: "Auto-S", 10: "Auto-ST"
};

// RespEventID → category used for per-day index accumulation.
const EVENT_CATEGORY = {
  101: "obstructive",
  102: "central",
  103: "central", // clear-airway apnea
  105: "central",
  106: "central",
  111: "hypopnea",
  112: "hypopnea"
};

class PrismaLineLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "Löwenstein Medical";
  }

  getDeviceCapabilities() {
    return {
      ...super.getDeviceCapabilities(),
      supportsAHI: true,
      supportsPressurePercentiles: true
    };
  }

  static detect(sdCardPath) {
    return fs.existsSync(path.join(sdCardPath, CONFIG_FILE));
  }

  async loadAll(onProgress) {
    let configEntries;
    try {
      configEntries = readZipEntries(fs.readFileSync(path.join(this.dataPath, CONFIG_FILE)));
    } catch {
      this.deviceInfo = this._defaultDeviceInfo();
      return this.buildSummary(this.deviceInfo, []);
    }

    this.deviceInfo = parsePrismaConfig(configEntries);

    let dailyStats = [];
    try {
      const therapyEntries = readZipEntries(fs.readFileSync(path.join(this.dataPath, THERAPY_FILE)));
      dailyStats = buildDailyStats(therapyEntries, (date) => this.blankDay(date));
    } catch {
      // therapy.pdat missing or unreadable: device info only.
    }

    if (onProgress) onProgress({ done: dailyStats.length, total: dailyStats.length });
    return this.buildSummary(this.deviceInfo, dailyStats);
  }

  _defaultDeviceInfo() {
    return {
      serialNumber: "Unknown",
      productName: "Prisma Line",
      productCode: "PRISMA",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
  }
}

function parsePrismaConfig(entries) {
  const xmlBuf = entries.get(DEVICE_XML);
  if (!xmlBuf) {
    return {
      serialNumber: "Unknown",
      productName: "Prisma Line",
      productCode: "PRISMA",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
  }
  const xml = xmlBuf.toString("utf8");
  const deviceType = xmlAttrValue(xml, "DeviceType") || "";
  const serial = xmlAttrValue(xml, "DeviceSerialNumber") || "";
  const fwVersion = xmlAttrValue(xml, "FWVersion") || "";
  const model = MODEL_NAMES[deviceType] || `Prisma Line (type ${deviceType})`;

  return {
    serialNumber: serial || "Unknown",
    productName: model,
    productCode: deviceType || "PRISMA",
    machineId: "Unknown",
    firmwareVersion: fwVersion || "Unknown"
  };
}

function buildDailyStats(entries, makeBlankDay) {
  const dayMap = parsePrismaStatistics(entries.get(STATISTICS_BIN));
  const eventsByDate = parsePrismaEvents(entries);

  const dailyStats = [];
  for (const [date, acc] of dayMap) {
    const usageHours = acc.totalUsageSec / 3600;
    if (usageHours <= 0) continue;

    const day = makeBlankDay(date);
    day.usageHours = usageHours;
    day.onDuration = acc.totalUsageSec / 60;
    const setPressure = acc.setPressureX100 / 100;
    day.pressure = setPressure;
    day.maxPressure = setPressure;
    day.raw.pressureMode = MODE_LABELS[acc.dominantMode] || "CPAP";

    const counts = eventsByDate.get(date);
    if (counts) {
      const oai = counts.obstructive / usageHours;
      const cai = counts.central / usageHours;
      const hi = counts.hypopnea / usageHours;
      day.oai = oai;
      day.cai = cai;
      day.hi = hi;
      day.ai = oai + cai;
      day.ahi = oai + cai + hi;
    } else {
      day.ahi = null; day.ai = null; day.hi = null;
      day.oai = null; day.cai = null; day.uai = null;
    }

    dailyStats.push(day);
  }

  return dailyStats.sort((a, b) => a.date.localeCompare(b.date));
}

// Parse statistics_year.bin (XML) into date -> { totalUsageSec, dominantMode,
// dominantUsageSec, setPressureX100 }.  Mirrors prisma_line.rs parse_daily_summaries.
function parsePrismaStatistics(xmlBuf) {
  const days = new Map();
  if (!xmlBuf) return days;
  const xml = xmlBuf.toString("utf8");

  let currentDate = null;
  let currentMode = 0;
  let currentUsageSec = 0;

  const tagRe = /<(\/?)([\w:]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const closing = m[1] === "/";
    const name = m[2];
    const attrs = m[3];

    if (!closing) {
      if (name === "day") {
        currentDate = tagAttr(attrs, "d");
        currentMode = 0;
        currentUsageSec = 0;
      } else if (name === "rec") {
        if (!currentDate) continue;
        const mode = parseInt(tagAttr(attrs, "m"), 10) || 0;
        if (!MODE_LABELS[mode]) {
          currentMode = 0;
          currentUsageSec = 0;
          continue;
        }
        currentMode = mode;
        currentUsageSec = parseTIntervalsTotalSec(tagAttr(attrs, "t") || "");
        let acc = days.get(currentDate);
        if (!acc) {
          acc = { totalUsageSec: 0, dominantMode: currentMode, dominantUsageSec: 0, setPressureX100: 0 };
          days.set(currentDate, acc);
        }
        acc.totalUsageSec += currentUsageSec;
        if (currentUsageSec > acc.dominantUsageSec) {
          acc.dominantMode = currentMode;
          acc.dominantUsageSec = currentUsageSec;
        }
      } else if (name === "s") {
        if (!currentDate || currentMode === 0) continue;
        if (tagAttr(attrs, "i") === "309") {
          const val = parseInt(tagAttr(attrs, "v"), 10);
          const acc = days.get(currentDate);
          if (Number.isFinite(val) && acc && currentUsageSec >= acc.dominantUsageSec) {
            acc.setPressureX100 = val;
          }
        }
      }
    } else {
      if (name === "day") {
        currentDate = null;
        currentMode = 0;
        currentUsageSec = 0;
      } else if (name === "rec") {
        currentMode = 0;
        currentUsageSec = 0;
      }
    }
  }

  return days;
}

// Aggregate respiratory events from all event_*.xml entries, bucketed by the
// YYYYMMDD date folder in each entry's path.
function parsePrismaEvents(entries) {
  const byDate = new Map();
  for (const [name, buf] of entries) {
    if (!name.startsWith(EVENTS_PREFIX) || !name.endsWith(".xml")) continue;
    const dateMatch = /\/(\d{4})(\d{2})(\d{2})\//.exec(name);
    if (!dateMatch) continue;
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

    let counts = byDate.get(date);
    if (!counts) {
      counts = { obstructive: 0, central: 0, hypopnea: 0 };
      byDate.set(date, counts);
    }
    countEventsInto(buf.toString("utf8"), counts);
  }
  return byDate;
}

function countEventsInto(xml, counts) {
  const re = /<RespEvent\b[^>]*>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const id = parseInt(tagAttr(m[0], "RespEventID"), 10);
    const category = EVENT_CATEGORY[id];
    if (category) counts[category] += 1;
  }
}

// Sum total seconds from a `t` attribute like "63000-3600,70000-1800"
// (each part is "start-durationSeconds"; we sum the durations).
function parseTIntervalsTotalSec(tStr) {
  let total = 0;
  for (const part of tStr.split(",")) {
    const dash = part.indexOf("-");
    if (dash < 0) continue;
    const dur = parseInt(part.slice(dash + 1), 10);
    if (Number.isFinite(dur)) total += dur;
  }
  return total;
}

// Extract the `value` attribute of the first element named `tagName`
// (device.xml uses `<TagName value="..."/>`).
function xmlAttrValue(xml, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*?\\bvalue="([^"]*)"`, "i");
  const m = re.exec(xml);
  return m ? m[1] : null;
}

// Read a single attribute value from a tag/attribute fragment.
function tagAttr(fragment, name) {
  const re = new RegExp(`\\b${name}="([^"]*)"`);
  const m = re.exec(fragment);
  return m ? m[1] : null;
}

module.exports = {
  PrismaLineLoader,
  parsePrismaConfig,
  parsePrismaStatistics,
  parsePrismaEvents
};
