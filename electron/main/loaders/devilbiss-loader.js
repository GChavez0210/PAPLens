"use strict";

// DeVilbiss IntelliPAP DV6 loader
//
// SD card layout (DV6):
//   DV6/
//     VER.BIN  – null-terminated ASCII fields: [unknown, serial, model]
//     SET.BIN  – 128-byte settings record (LE); byte 11 = capabilities (0=CPAP)
//     S.BIN    – rolling-buffer daily summaries; 56-byte header + 55-byte records
//     U.BIN    – session timestamps; 56-byte header + 9-byte records
//
// S.BIN record (55 bytes, all BE unless noted):
//   0-3:   BE u32 start_time   (seconds since DeVilbiss epoch 2002-01-01 UTC)
//   4-7:   BE u32 stop_time
//   8-11:  BE u32 written
//   12:    u8  hours           (÷10 → hours)
//   14:    u8  pressure_avg    (÷10 → cmH₂O)
//   15:    u8  pressure_max    (÷10)
//   16:    u8  pressure_50     (÷10)
//   17:    u8  pressure_90     (÷10)
//   18:    u8  pressure_95     (÷10)
//   19:    u8  pressure_std    (÷10)
//   21:    u8  leak_avg        (÷10 → L/min)
//   22:    u8  leak_max        (÷10)
//   23:    u8  leak_50         (÷10)
//   24:    u8  leak_90         (÷10)
//   25:    u8  leak_95         (÷10)
//   26:    u8  leak_std        (÷10)
//   27-28: LE u16 tidal_volume (mL, no scaling)
//   29:    u8  avg_breath_rate (breaths/min, no scaling)
//   31:    u8  snores          (count)
//   32:    u8  time_in_exp     (÷2 → %)
//   33:    u8  time_in_fl      (÷2 → %)
//   34:    u8  time_in_pb      (÷2 → %)
//   35:    u8  mask_fit        (÷2 → %)
//   36:    u8  index_oa        (÷4 → OA events/hr)
//   37:    u8  index_ca        (÷4 → CA events/hr)
//   38:    u8  index_hyp       (÷4 → hypopnea events/hr)
//   48:    u8  pressure_set_min (÷10)
//   49:    u8  pressure_set_max (÷10)
//
// DV6 rolling-file header (56 bytes):
//   byte 17:   record length (should be 55)
//   bytes 18-21 BE u32: wrap index (next write slot in the circular buffer)
//
// Derived from cpap-parser (GPL-3.0) src/parsers/devilbiss.rs.  See NOTICES.md.

const fs = require("fs");
const path = require("path");
const { BaseLoader } = require("./base-loader");

const DV6_EPOCH = 1009843200; // 2002-01-01T00:00:00Z in Unix seconds
const ROLLING_HDR = 56;
const SBIN_RECORD = 55;
const UBIN_HDR = 56;
const UBIN_RECORD = 9;

class DeVilbissLoader extends BaseLoader {
  constructor(dataPath) {
    super(dataPath);
    this.manufacturer = "DeVilbiss";
  }

  static detect(sdCardPath) {
    return fs.existsSync(path.join(sdCardPath, "DV6", "S.BIN"));
  }

  async loadDeviceInfo() {
    const dv6 = path.join(this.dataPath, "DV6");
    let serialNumber = "Unknown";
    let productName = "IntelliPAP";
    let isApap = false;

    // VER.BIN: null/0xFF terminated ASCII fields [unknown, serial, model]
    try {
      const ver = fs.readFileSync(path.join(dv6, "VER.BIN"));
      const fields = this._splitNullFields(ver);
      if (fields[1]) serialNumber = fields[1];
      if (fields[2]) productName = `IntelliPAP ${fields[2]}`;
    } catch {
      // VER.BIN is optional for detection; defaults keep import usable.
    }

    // SET.BIN: byte 11 nonzero → APAP capable
    try {
      const set = fs.readFileSync(path.join(dv6, "SET.BIN"));
      if (set.length > 11) isApap = set[11] !== 0;
    } catch {
      // SET.BIN is optional; default to fixed-pressure naming.
    }

    this.deviceInfo = {
      serialNumber,
      productName: isApap ? productName.replace("IntelliPAP", "IntelliPAP Auto") : productName,
      productCode: "DEVILBISS_DV6",
      machineId: "Unknown",
      firmwareVersion: "Unknown"
    };
  }

  async loadAll(onProgress) {
    await this.loadDeviceInfo();

    const dv6 = path.join(this.dataPath, "DV6");
    let sBuf, uBuf;
    try {
      sBuf = fs.readFileSync(path.join(dv6, "S.BIN"));
    } catch {
      return this.buildSummary(this.deviceInfo, []);
    }
    try {
      uBuf = fs.readFileSync(path.join(dv6, "U.BIN"));
    } catch {
      uBuf = null;
    }

    this.sessions = uBuf ? this._parseUBin(uBuf) : [];
    const dailyStats = this._parseSBin(sBuf);

    if (onProgress) onProgress({ done: dailyStats.length, total: dailyStats.length });
    return this.buildSummary(this.deviceInfo, dailyStats);
  }

  _parseSBin(buf) {
    if (buf.length < ROLLING_HDR + SBIN_RECORD) return [];

    // Read wrap index from rolling-file header (bytes 18-21 BE u32)
    // We filter on timestamp == 0 to identify empty slots; no reordering needed.
    const recordsStart = ROLLING_HDR;
    const count = Math.floor((buf.length - recordsStart) / SBIN_RECORD);
    const daily = [];

    for (let i = 0; i < count; i++) {
      const off = recordsStart + i * SBIN_RECORD;
      const startRaw = buf.readUInt32BE(off + 0);
      if (startRaw === 0) continue;

      const unixStart = (startRaw + DV6_EPOCH) * 1000;
      const stopRaw = buf.readUInt32BE(off + 4);
      const unixStop = (stopRaw + DV6_EPOCH) * 1000;
      const durationHours = (unixStop - unixStart) / 3_600_000;

      const _d = new Date(unixStart);
      const dateStr = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;

      const u = (o) => buf[off + o];
      const le16 = (o) => buf.readUInt16LE(off + o);

      const oai = u(36) / 4;
      const cai = u(37) / 4;
      const hi = u(38) / 4;
      const ahi = oai + cai + hi;

      const day = this.blankDay(dateStr);
      day.ahi = ahi;
      day.oai = oai;
      day.cai = cai;
      day.hi = hi;
      day.ai = oai + cai; // apnea index = OA + CA
      day.usageHours = u(12) !== 0 ? u(12) / 10 : durationHours;
      day.onDuration = day.usageHours * 60;

      day.pressure = u(16) / 10 || null;    // P50
      day.maxPressure = u(18) / 10 || null; // P95

      day.leak50 = u(23) / 10 || null;
      day.leak95 = u(25) / 10 || null;

      day.tidVol50 = le16(27) || null;
      day.tidVol95 = le16(27) || null; // only one tidal vol stat available

      day.respRate50 = u(29) || null;
      // time_in_fl stored as half-percent units (÷2 → %, ÷100 → fraction 0–1).
      // Use explicit null check so 0% flow limitation (a valid result) isn't lost.
      day.flowLimP95 = u(33) !== 0 ? u(33) / 2 / 100 : 0;

      daily.push(day);
    }

    return daily.sort((a, b) => a.date.localeCompare(b.date));
  }

  _parseUBin(buf) {
    const out = [];
    if (buf.length < UBIN_HDR + UBIN_RECORD) return out;
    const count = Math.floor((buf.length - UBIN_HDR) / UBIN_RECORD);
    for (let i = 0; i < count; i++) {
      const off = UBIN_HDR + i * UBIN_RECORD;
      const beginRaw = buf.readUInt32BE(off + 0);
      const endRaw = buf.readUInt32BE(off + 4);
      if (!beginRaw) continue;
      out.push({
        begin: (beginRaw + DV6_EPOCH) * 1000,
        end: (endRaw + DV6_EPOCH) * 1000
      });
    }
    return out;
  }

  // Split VER.BIN content on null bytes (0x00) or end-of-file markers (0xFF)
  _splitNullFields(buf) {
    const fields = [];
    let start = 0;
    for (let i = 0; i <= buf.length; i++) {
      if (i === buf.length || buf[i] === 0x00 || buf[i] === 0xff) {
        const s = buf.slice(start, i).toString("ascii").trim();
        if (s) fields.push(s);
        start = i + 1;
      }
    }
    return fields;
  }
}

module.exports = { DeVilbissLoader };
