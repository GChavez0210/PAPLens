const fs = require("fs");
const path = require("path");
const { parseSTRFile, parseSessionFile } = require("../parsers/edf-parser");
const {
  buildLeakAndTidalSummary,
  describeSamples,
  formatDebugValue,
  leakMappings,
  pickMappedValue,
  safeInfo,
  tidalMappings,
  toOptionalNumber
} = require("./therapyMetrics");
const { summarizeNightlySessionMetrics } = require("./sessionMetrics");

const OXIMETRY_UNSUPPORTED_PRODUCT_PATTERNS = [
  /^AirSense/i,
  /^AirCurve/i,
  /^Lumis/i,
  /^AirMini/i
];

function inferDeviceCapabilities(deviceInfo = {}) {
  const productName = String(deviceInfo.productName || "").replace(/\s+/g, "");
  const supportsOximetry = !OXIMETRY_UNSUPPORTED_PRODUCT_PATTERNS.some((pattern) => pattern.test(productName));

  return {
    supportsOximetry
  };
}

class CPAPDataLoader {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.deviceInfo = null;
    this.deviceCapabilities = inferDeviceCapabilities();
    this.dailySummary = null;
    this.sessions = [];
    this.dayStartHour = 12;
    this.dayEndHour = 12;
    this.nightlySessionMetrics = null;
  }

  pickPositiveMetric(...values) {
    for (const value of values) {
      const numeric = toOptionalNumber(value);
      if (numeric !== null && numeric > 0) {
        return numeric;
      }
    }
    return null;
  }

  setDayBoundary(startHour, endHour) {
    this.dayStartHour = startHour;
    this.dayEndHour = endHour;
    this.sleepNightUsage = this.calculateSleepNightUsage();
    this.nightlySessionMetrics = null;
  }

  getDeviceCapabilities() {
    if (!this.deviceCapabilities) {
      this.deviceCapabilities = inferDeviceCapabilities(this.deviceInfo);
    }
    return this.deviceCapabilities;
  }

  async loadAll() {
    await this.loadDeviceInfo();
    await this.loadDailySummary();
    await this.loadSessionList();
    return this.getSummary();
  }

  async loadDeviceInfo() {
    const jsonPath = path.join(this.dataPath, "Identification.json");
    if (fs.existsSync(jsonPath)) {
      try {
        const content = fs.readFileSync(jsonPath, "utf8");
        const data = JSON.parse(content);
        const product = data?.FlowGenerator?.IdentificationProfiles?.Product || {};
        const software = data?.FlowGenerator?.IdentificationProfiles?.Software || {};
        const hardware = data?.FlowGenerator?.IdentificationProfiles?.Hardware || {};

        this.deviceInfo = {
          serialNumber: product.SerialNumber || "Unknown",
          productName: product.ProductName ? product.ProductName.replace(/([a-z])([A-Z])/g, '$1 $2') : "Unknown",
          productCode: product.ProductCode || "Unknown",
          machineId: hardware.HardwareIdentifier || "Unknown",
          firmwareVersion: software.ApplicationIdentifier || "Unknown",
          raw: data
        };
        this.deviceCapabilities = inferDeviceCapabilities(this.deviceInfo);
        return;
      } catch (err) {
        console.error("Failed to parse Identification.json", err);
      }
    }

    const idPath = path.join(this.dataPath, "Identification.tgt");
    if (!fs.existsSync(idPath)) {
      this.deviceInfo = { error: "Identification file not found" };
      return;
    }

    const content = fs.readFileSync(idPath, "utf8");
    const info = {};
    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(/^#(\w+)\s+(.+)$/);
      if (match) {
        info[match[1]] = match[2].trim();
      }
    }

    this.deviceInfo = {
      serialNumber: info.SRN || "Unknown",
      productName: info.PNA ? info.PNA.replace(/_/g, " ") : "Unknown",
      productCode: info.PCD || "Unknown",
      machineId: info.MID || "Unknown",
      firmwareVersion: info.FGT || "Unknown",
      raw: info
    };
    this.deviceCapabilities = inferDeviceCapabilities(this.deviceInfo);
  }

  async loadDailySummary() {
    const strPath = path.join(this.dataPath, "STR.edf");
    if (!fs.existsSync(strPath)) {
      this.dailySummary = { error: "STR.edf not found" };
      return;
    }

    try {
      this.dailySummary = parseSTRFile(strPath);
    } catch (error) {
      this.dailySummary = { error: error.message };
    }
  }

  async loadSessionList() {
    const datalogPath = path.join(this.dataPath, "DATALOG");
    if (!fs.existsSync(datalogPath)) {
      this.sessions = [];
      return;
    }

    const dateDirs = fs
      .readdirSync(datalogPath)
      .filter((d) => /^\d{8}$/.test(d))
      .sort()
      .reverse();

    this.sessions = [];
    for (const dateDir of dateDirs) {
      const datePath = path.join(datalogPath, dateDir);
      const files = fs.readdirSync(datePath);
      const sessionMap = new Map();

      for (const file of files) {
        if (!file.endsWith(".edf")) {
          continue;
        }
        const match = file.match(/^(\d{8}_\d{6})_(\w+)\.edf$/);
        if (!match) {
          continue;
        }
        const sessionId = match[1];
        const fileType = match[2];
        if (!sessionMap.has(sessionId)) {
          sessionMap.set(sessionId, {
            id: sessionId,
            date: dateDir,
            timestamp: this.parseSessionTimestamp(sessionId),
            files: {},
            durationMinutes: 0
          });
        }
        sessionMap.get(sessionId).files[fileType] = path.join(datePath, file);
      }

      for (const session of sessionMap.values()) {
        if (session.files.BRP) {
          session.durationMinutes = this.getSessionDuration(session.files.BRP);
        }
      }

      this.sessions.push(...sessionMap.values());
    }

    this.sleepNightUsage = this.calculateSleepNightUsage();
    this.nightlySessionMetrics = null;
  }

  getSessionDuration(brpFilePath) {
    try {
      const buffer = fs.readFileSync(brpFilePath);
      const numDataRecords = parseInt(buffer.slice(236, 244).toString("ascii").trim(), 10) || 0;
      const dataRecordDuration = parseFloat(buffer.slice(244, 252).toString("ascii").trim()) || 0;
      return (numDataRecords * dataRecordDuration) / 60;
    } catch (_error) {
      return 0;
    }
  }

  calculateSleepNightUsage() {
    const sleepNights = new Map();
    for (const session of this.sessions) {
      if (!session.timestamp || session.durationMinutes <= 0) {
        continue;
      }
      const dateKey = this.getSleepNightKey(session.timestamp);
      if (!sleepNights.has(dateKey)) {
        sleepNights.set(dateKey, { date: dateKey, totalMinutes: 0, sessionCount: 0 });
      }
      const night = sleepNights.get(dateKey);
      night.totalMinutes += session.durationMinutes;
      night.sessionCount++;
    }
    return sleepNights;
  }

  getSleepNightKey(timestamp) {
    const sessionDate = timestamp instanceof Date ? new Date(timestamp) : new Date(timestamp);
    if (Number.isNaN(sessionDate.getTime())) {
      return null;
    }

    if (sessionDate.getHours() < this.dayStartHour) {
      sessionDate.setDate(sessionDate.getDate() - 1);
    }

    return sessionDate.toISOString().split("T")[0];
  }

  parseSessionTimestamp(sessionId) {
    const match = sessionId.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
    if (!match) {
      return null;
    }
    return new Date(
      parseInt(match[1], 10),
      parseInt(match[2], 10) - 1,
      parseInt(match[3], 10),
      parseInt(match[4], 10),
      parseInt(match[5], 10),
      parseInt(match[6], 10)
    );
  }

  async loadSessionDetail(sessionId) {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return { error: "Session not found" };
    }

    const detail = {
      id: session.id,
      date: session.date,
      timestamp: session.timestamp,
      data: {}
    };

    for (const [fileType, filePath] of Object.entries(session.files)) {
      try {
        const parsed = parseSessionFile(filePath);
        detail.data[fileType] = {
          header: parsed.header,
          signals: parsed.signals.map((s) => s.label),
          sampleCounts: Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v.length])),
          rawData: parsed.data
        };
      } catch (error) {
        detail.data[fileType] = { error: error.message };
      }
    }

    return detail;
  }

  buildNightlySessionMetrics() {
    if (this.nightlySessionMetrics) {
      return this.nightlySessionMetrics;
    }

    const { supportsOximetry } = this.getDeviceCapabilities();
    const nightly = new Map();
    let skippedUnsupportedSa2 = false;

    for (const session of this.sessions) {
      const nightKey = this.getSleepNightKey(session.timestamp);
      if (!nightKey) {
        continue;
      }

      if (!nightly.has(nightKey)) {
        nightly.set(nightKey, {
          leakSamples: [],
          tidalSamples: [],
          minVentSamples: [],
          respRateSamples: [],
          flowLimSamples: [],
          spo2Samples: [],
          pulseSamples: [],
          annotations: []
        });
      }

      const aggregate = nightly.get(nightKey);

      if (session.files.PLD) {
        try {
          const pld = parseSessionFile(session.files.PLD);
          aggregate.leakSamples.push(...(pld.data["Leak.2s"] || []));
          aggregate.tidalSamples.push(...(pld.data["TidVol.2s"] || []));
          aggregate.minVentSamples.push(...(pld.data["MinVent.2s"] || []));
          aggregate.respRateSamples.push(...(pld.data["RespRate.2s"] || []));
          aggregate.flowLimSamples.push(...(pld.data["FlowLim.2s"] || []));
        } catch (error) {
          safeInfo(console, `[session-parse] Failed PLD parse for ${session.id}: ${error.message}`);
        }
      }

      if (session.files.SA2 && supportsOximetry) {
        try {
          const sa2 = parseSessionFile(session.files.SA2);
          aggregate.pulseSamples.push(...(sa2.data["Pulse.1s"] || []));
          aggregate.spo2Samples.push(...(sa2.data["SpO2.1s"] || []));
        } catch (error) {
          safeInfo(console, `[session-parse] Failed SA2 parse for ${session.id}: ${error.message}`);
        }
      } else if (session.files.SA2) {
        skippedUnsupportedSa2 = true;
      }

      if (session.files.EVE) {
        try {
          const eve = parseSessionFile(session.files.EVE);
          aggregate.annotations.push(...(eve.data["EDF Annotations"] || []));
        } catch (error) {
          safeInfo(console, `[session-parse] Failed EVE parse for ${session.id}: ${error.message}`);
        }
      }
    }

    this.nightlySessionMetrics = new Map(
      Array.from(nightly.entries()).map(([nightKey, aggregate]) => [nightKey, summarizeNightlySessionMetrics(aggregate)])
    );

    if (skippedUnsupportedSa2) {
      safeInfo(
        console,
        `[session-parse] Skipped SA2 parsing for ${this.deviceInfo?.productName || "device"} because onboard oximetry is unsupported for this device class`
      );
    }

    return this.nightlySessionMetrics;
  }

  getDailyStats() {
    if (!this.dailySummary || !this.dailySummary.days) {
      return [];
    }

    const { supportsOximetry } = this.getDeviceCapabilities();
    const nightlySessionMetrics = this.buildNightlySessionMetrics();

    const stats = this.dailySummary.days
      .map((day, index) => {
        const startDate = this.dailySummary.header.startDate;
        let dateStr = day._date;
        if (!dateStr && startDate) {
          const monthNames = {
            JAN: 0,
            FEB: 1,
            MAR: 2,
            APR: 3,
            MAY: 4,
            JUN: 5,
            JUL: 6,
            AUG: 7,
            SEP: 8,
            OCT: 9,
            NOV: 10,
            DEC: 11
          };
          const match = startDate.match(/(\d{2})-([A-Z]{3})-(\d{4})/);
          if (match) {
            const d = new Date(
              parseInt(match[3], 10),
              monthNames[match[2]],
              parseInt(match[1], 10) + index
            );
            dateStr = d.toISOString().split("T")[0];
          }
        }

        const sleepNight = this.sleepNightUsage ? this.sleepNightUsage.get(dateStr) : null;
        const sessionMetrics = nightlySessionMetrics.get(dateStr);
        const usageMinutes = sleepNight ? sleepNight.totalMinutes : (toOptionalNumber(day.OnDuration) ?? 0);
        const leak50 = pickMappedValue(day, leakMappings.p50);
        const leak95 = pickMappedValue(day, leakMappings.p95);
        const leakMax = pickMappedValue(day, leakMappings.max);
        const tidVol50 = pickMappedValue(day, tidalMappings.p50);
        const tidVol95 = pickMappedValue(day, tidalMappings.p95);
        const mappedPressure = toOptionalNumber(day["S.C.Press"]) ?? toOptionalNumber(day["S.AS.MinPress"]);
        const mappedMaxPressure = toOptionalNumber(day["S.AS.MaxPress"]) ?? toOptionalNumber(day["S.C.Press"]);
        const respRate50 = toOptionalNumber(day["RespRate.50"]);
        const respRate95 = toOptionalNumber(day["RespRate.95"]);

        return {
          date: dateStr || `Day ${index + 1}`,
          ahi: toOptionalNumber(day.AHI) ?? 0,
          ai: toOptionalNumber(day.AI) ?? 0,
          hi: toOptionalNumber(day.HI) ?? 0,
          oai: toOptionalNumber(day.OAI) ?? 0,
          cai: toOptionalNumber(day.CAI) ?? 0,
          uai: toOptionalNumber(day.UAI) ?? 0,
          duration: toOptionalNumber(day.Duration) ?? 0,
          onDuration: toOptionalNumber(day.OnDuration) ?? 0,
          usageHours: usageMinutes / 60,
          patientHoursCumulative: toOptionalNumber(day.PatientHours) ?? 0,
          leak50: sessionMetrics?.leak50 ?? leak50.value,
          leak95: sessionMetrics?.leak95 ?? leak95.value,
          leakMax: sessionMetrics?.leakMax ?? leakMax.value,
          pressure: mappedPressure,
          maxPressure: mappedMaxPressure,
          minVent50: sessionMetrics?.minVent50 ?? toOptionalNumber(day["MinVent.50"]),
          minVent95: sessionMetrics?.minVent95 ?? toOptionalNumber(day["MinVent.95"]),
          tidVol50: sessionMetrics?.tidVol50 ?? tidVol50.value,
          tidVol95: sessionMetrics?.tidVol95 ?? tidVol95.value,
          respRate50: sessionMetrics?.respRate50 ?? respRate50,
          respRate95: sessionMetrics?.respRate95 ?? respRate95,
          flowLimP95: sessionMetrics?.flowLimP95 ?? null,
          eventClusterIndexSource: sessionMetrics?.eventClusterIndexSource ?? null,
          // Current ResMed flow generators do not provide valid onboard oximetry,
          // so PAPLens preserves null instead of probing SA2/summary sentinels.
          spo2Avg: supportsOximetry
            ? (sessionMetrics?.spo2Avg ?? this.pickPositiveMetric(day["SpO2.Avg"], day.SpO2Avg, day["SpO2.50"]))
            : null,
          pulseAvg: supportsOximetry
            ? (sessionMetrics?.pulseAvg ?? this.pickPositiveMetric(day["Pulse.Avg"], day.PulseAvg, day["Pulse.50"]))
            : null,
          raw: day,
          sourceMetrics: {
            leak50Field: sessionMetrics?.leak50 != null ? "Leak.2s" : leak50.field,
            leak95Field: sessionMetrics?.leak95 != null ? "Leak.2s" : leak95.field,
            leakMaxField: sessionMetrics?.leakMax != null ? "Leak.2s" : leakMax.field,
            tidVol50Field: sessionMetrics?.tidVol50 != null ? "TidVol.2s" : tidVol50.field,
            tidVol95Field: sessionMetrics?.tidVol95 != null ? "TidVol.2s" : tidVol95.field,
            flowLimP95Field: sessionMetrics?.flowLimP95 != null ? "FlowLim.2s" : null,
            eventClusterField: sessionMetrics?.eventClusterIndexSource != null ? "EDF Annotations" : null
          }
        };
      })
      .filter((day) => day.duration > 0 || day.onDuration > 0);

    const leakStats = describeSamples(stats.map((day) => day.leak95));
    const tidalStats = describeSamples(stats.map((day) => day.tidVol50));
    safeInfo(console,
      `[import] Leak samples parsed=${leakStats.count} min=${formatDebugValue(leakStats.min)} max=${formatDebugValue(leakStats.max)}`
    );
    safeInfo(console,
      `[import] Tidal samples parsed=${tidalStats.count} min=${formatDebugValue(tidalStats.min)} max=${formatDebugValue(tidalStats.max)}`
    );

    return stats;
  }

  getSummary() {
    const stats = this.getDailyStats();
    const recentDays = stats.slice(-30);

    const calcAvg = (field) => {
      const values = recentDays
        .map((day) => toOptionalNumber(day[field]))
        .filter((value) => value !== null);

      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const metricSummary = buildLeakAndTidalSummary(recentDays, console, "analytics:summary");

    return {
      deviceInfo: this.deviceInfo,
      deviceCapabilities: this.getDeviceCapabilities(),
      totalDays: stats.length,
      recentDays: recentDays.length,
      averages: {
        ahi: calcAvg('ahi'),
        usage: calcAvg('usageHours'),
        pressure: calcAvg('maxPressure'),
        leak: metricSummary.leak,
        flowRate: calcAvg('minVent95'),
        tidalVolume: metricSummary.tidalVolume
      },
      metricSummary,
      dailyStats: stats,
      sessions: this.sessions.slice(0, 50)
    };
  }
}

module.exports = { CPAPDataLoader, inferDeviceCapabilities };
