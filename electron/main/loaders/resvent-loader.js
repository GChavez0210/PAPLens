"use strict";

// Resvent iBreezer / Hoffrichter Point 3 loader
//
// SD card layout:  THERAPY/CONFIG/   (device settings, key=value)
//                  THERAPY/RECORD/YYYYMM/DD/  (per-session files)
//                    STAT<N>   – daily summary (key=value, 4-byte binary header)
//                    EV<N>     – events (text, one per line: ID=x,DT=x,DR=x,GD=x,)
//                    W<N>_<c>  – waveforms at 25 Hz (binary, skipped for now)
//                    P<N>_<c>  – 2–4 Hz channels (binary, parsed for percentiles)
//
// Binary waveform format (W and P files):
//   0x24 byte main header
//     +0x10 LE u16: chunk duration in seconds
//     +0x12 LE u16: number of description headers (channels)
//     +0x1e LE u16: samples per chunk
//   0x20 byte description header per channel:
//     +0x00 8-byte ASCII channel name (null-padded)
//   Then signed int16 LE samples, interleaved by channel, chunk by chunk
//
// Derived from OSCAR (GPL-3.0) resvent_loader.cpp.  See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");

const MAIN_HDR = 0x24;
const DESC_HDR = 0x20;

// Physical gain factors per channel name (from OSCAR)
const CHANNEL_GAIN = {
  Ti: 0.001,
  "I:E": 0.001,
  Pressure: 0.01,
  Flow: 0.01,
  Press: 0.01,
  IPAP: 0.01,
  EPAP: 0.01,
  MV: 0.01,
  Leak: 0.1,
  RR: 0.1,
  Vt: 1.0
};

class ResventLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "Resvent";
  }

  static detect(sdCardPath) {
    return (
      fs.existsSync(path.join(sdCardPath, "THERAPY", "CONFIG")) &&
      fs.existsSync(path.join(sdCardPath, "THERAPY", "RECORD"))
    );
  }

  async loadDeviceInfo() {
    const configDir = path.join(this.dataPath, "THERAPY", "CONFIG");
    let serialNumber = "Unknown";
    let productName = "Resvent iBreezer";
    let firmwareVersion = "Unknown";

    try {
      for (const file of fs.readdirSync(configDir)) {
        const fullPath = path.join(configDir, file);
        try {
          const buf = fs.readFileSync(fullPath);
          // Try with and without the 4-byte binary header
          for (const start of [0, 4]) {
            if (buf.length <= start) continue;
            const kv = this._parseKV(buf.slice(start).toString("utf8", 0, 512));
            if (kv.SerialNo) serialNumber = kv.SerialNo;
            if (kv.SN) serialNumber = kv.SN;
            if (kv.Model) productName = `Resvent ${kv.Model}`;
            if (kv.FW) firmwareVersion = kv.FW;
            if (kv.FWVersion) firmwareVersion = kv.FWVersion;
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // CONFIG dir unreadable, use defaults
    }

    this.deviceInfo = {
      serialNumber,
      productName,
      productCode: "RESVENT",
      machineId: "Unknown",
      firmwareVersion
    };
  }

  async loadAll(onProgress) {
    await this.loadDeviceInfo();

    const recordRoot = path.join(this.dataPath, "THERAPY", "RECORD");
    const dailyMap = new Map();

    let yearMonths;
    try {
      yearMonths = fs.readdirSync(recordRoot).filter(d => /^\d{6}$/.test(d)).sort();
    } catch {
      return this.buildSummary(this.deviceInfo, []);
    }

    for (const ym of yearMonths) {
      const ymPath = path.join(recordRoot, ym);
      let days;
      try {
        days = fs.readdirSync(ymPath).filter(d => /^\d{2}$/.test(d)).sort();
      } catch {
        continue;
      }

      for (const dd of days) {
        const dayPath = path.join(ymPath, dd);
        const year = ym.slice(0, 4);
        const month = ym.slice(4);
        const dateStr = `${year}-${month}-${dd.padStart(2, "0")}`;

        let sessionFiles;
        try {
          sessionFiles = fs.readdirSync(dayPath);
        } catch {
          continue;
        }

        const statNums = sessionFiles
          .filter(f => /^STAT\d+$/i.test(f))
          .map(f => f.replace(/^STAT/i, ""))
          .sort();

        for (const num of statNums) {
          try {
            this._processSession(dayPath, num, dateStr, dailyMap);
          } catch {
            // Skip malformed session files
          }
        }
      }
    }

    // Compute percentiles from accumulated per-day samples
    for (const day of dailyMap.values()) {
      this._finalizeDay(day);
    }

    const dailyStats = Array.from(dailyMap.values())
      .filter(d => d.usageHours > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (onProgress) onProgress({ done: dailyStats.length, total: dailyStats.length });
    return this.buildSummary(this.deviceInfo, dailyStats);
  }

  _processSession(dayPath, num, dateStr, dailyMap) {
    const statPath = path.join(dayPath, `STAT${num}`);
    const buf = fs.readFileSync(statPath);
    // Skip 4-byte binary header if first bytes are non-printable
    const textStart = buf[0] < 32 ? 4 : 0;
    const kv = this._parseKV(buf.slice(textStart).toString("utf8"));

    const secUsed = parseInt(kv.secUsed || "0", 10);
    if (secUsed <= 0) return;

    const usageHours = secUsed / 3600;
    const cnt = (k) => parseInt(kv[k] || "0", 10);
    const cntAHI = cnt("cntAHI");
    const cntOAI = cnt("cntOAI");
    const cntCAI = cnt("cntCAI");
    const cntHI = cnt("cntHI");
    const cntAI = cnt("cntAI");

    if (!dailyMap.has(dateStr)) {
      const day = this.blankDay(dateStr);
      day._pressureSamples = [];
      day._leakSamples = [];
      day._mvSamples = [];
      day._vtSamples = [];
      day._rrSamples = [];
      dailyMap.set(dateStr, day);
    }

    const day = dailyMap.get(dateStr);
    const prevH = day.usageHours;
    const totalH = prevH + usageHours;

    // Weighted-average the per-hour rates across multiple sessions
    if (totalH > 0) {
      day.ahi = (day.ahi * prevH + (cntAHI / usageHours) * usageHours) / totalH;
      day.oai = (day.oai * prevH + (cntOAI / usageHours) * usageHours) / totalH;
      day.cai = (day.cai * prevH + (cntCAI / usageHours) * usageHours) / totalH;
      day.hi = (day.hi * prevH + (cntHI / usageHours) * usageHours) / totalH;
      day.ai = (day.ai * prevH + (cntAI / usageHours) * usageHours) / totalH;
    }
    day.usageHours = totalH;
    day.onDuration += secUsed / 60;

    // Collect waveform samples from P files for this session
    this._collectPSamples(dayPath, num, day);
  }

  _collectPSamples(dayPath, num, day) {
    let files;
    try {
      files = fs.readdirSync(dayPath)
        .filter(f => new RegExp(`^P${num}_\\d+$`, "i").test(f))
        .sort();
    } catch {
      return;
    }

    for (const file of files) {
      try {
        const buf = fs.readFileSync(path.join(dayPath, file));
        this._parseWaveformBuffer(buf, day);
      } catch {
        // Skip unreadable chunk
      }
    }
  }

  _parseWaveformBuffer(buf, day) {
    if (buf.length < MAIN_HDR + DESC_HDR) return;

    const descCount = buf.readUInt16LE(0x12);
    if (descCount === 0 || descCount > 20) return;

    const channels = [];
    for (let i = 0; i < descCount; i++) {
      const off = MAIN_HDR + i * DESC_HDR;
      if (off + 9 > buf.length) break;
      const name = buf.slice(off, off + 9).toString("ascii").replace(/\0/g, "").trim();
      channels.push({ name, gain: CHANNEL_GAIN[name] ?? 1.0 });
    }

    const dataOffset = MAIN_HDR + descCount * DESC_HDR;
    let pos = dataOffset;
    const stride = channels.length * 2;

    while (pos + stride <= buf.length) {
      for (let i = 0; i < channels.length; i++) {
        const raw = buf.readInt16LE(pos + i * 2);
        const value = raw * channels[i].gain;
        const name = channels[i].name;

        if (name === "Press" || name === "Pressure" || name === "IPAP") {
          day._pressureSamples.push(value);
        } else if (name === "Leak") {
          day._leakSamples.push(value);
        } else if (name === "MV") {
          day._mvSamples.push(value);
        } else if (name === "Vt") {
          day._vtSamples.push(value);
        } else if (name === "RR") {
          day._rrSamples.push(value);
        }
      }
      pos += stride;
    }
  }

  _finalizeDay(day) {
    const pct = BaseLoader.percentile;
    const sort = (arr) => arr && arr.length ? [...arr].filter(v => v > 0).sort((a, b) => a - b) : null;

    const ps = sort(day._pressureSamples);
    const ls = sort(day._leakSamples);
    const ms = sort(day._mvSamples);
    const vs = sort(day._vtSamples);
    const rs = sort(day._rrSamples);

    if (ps) { day.pressure = pct(ps, 50); day.maxPressure = pct(ps, 95); }
    if (ls) { day.leak50 = pct(ls, 50); day.leak95 = pct(ls, 95); }
    if (ms) { day.minVent50 = pct(ms, 50); day.minVent95 = pct(ms, 95); }
    if (vs) { day.tidVol50 = pct(vs, 50); day.tidVol95 = pct(vs, 95); }
    if (rs) { day.respRate50 = pct(rs, 50); day.respRate95 = pct(rs, 95); }

    delete day._pressureSamples;
    delete day._leakSamples;
    delete day._mvSamples;
    delete day._vtSamples;
    delete day._rrSamples;
  }

  _parseKV(text) {
    const result = {};
    for (const line of text.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key) result[key] = val;
    }
    return result;
  }
}

module.exports = { ResventLoader };
