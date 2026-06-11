const fs = require("fs");
const path = require("path");
const { parseSTRFileAsync, parseSessionFile, parseSessionFileAsync } = require("../parsers/edf-parser");
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

const MAX_IPC_SIGNAL_POINTS = 2000;

function downsampleSignal(values, maxPoints = MAX_IPC_SIGNAL_POINTS) {
  if (!Array.isArray(values) || values.length <= maxPoints) {
    return { values, downsampled: false, originalLength: values?.length ?? 0, stride: 1 };
  }

  const stride = Math.ceil(values.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < values.length; i += stride) {
    sampled.push(values[i]);
  }
  return { values: sampled, downsampled: true, originalLength: values.length, stride };
}

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
    this.manufacturer = "ResMed";
    this.deviceInfo = null;
    this.deviceCapabilities = inferDeviceCapabilities();
    this.dailySummary = null;
    this.sessions = [];
    this.dayStartHour = 12;
    this.dayEndHour = 12;
    this.timeZone = null;
    this.nightlySessionMetrics = null;
    this.strCache = null;
  }

  setSTRCache(cache) {
    this.strCache = cache || null;
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

  setDayBoundary(startHour, endHour, timeZone = this.timeZone) {
    const normalizedTimeZone = normalizeTimeZone(timeZone);
    if (timeZone && !normalizedTimeZone) {
      throw new Error(`Invalid timezone: ${timeZone}`);
    }
    this.dayStartHour = startHour;
    this.dayEndHour = endHour;
    this.timeZone = normalizedTimeZone;
    this.sleepNightUsage = this.calculateSleepNightUsage();
    this.nightlySessionMetrics = null;
  }

  getDeviceCapabilities() {
    if (!this.deviceCapabilities) {
      this.deviceCapabilities = inferDeviceCapabilities(this.deviceInfo);
    }
    return this.deviceCapabilities;
  }

  async loadAll(onProgress, skipDates = new Set(), cachedSessionMetrics = new Map()) {
    await this.loadDeviceInfo();
    await this.loadDailySummary();
    await this.loadSessionList();
    return this.getSummary(onProgress, skipDates, cachedSessionMetrics);
  }

  async loadDeviceInfo() {
    const jsonPath = path.join(this.dataPath, "Identification.json");
    if (fs.existsSync(jsonPath)) {
      try {
        const content = await fs.promises.readFile(jsonPath, "utf8");
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

    const content = await fs.promises.readFile(idPath, "utf8");
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
      const stat = await fs.promises.stat(strPath);
      if (
        this.strCache?.summary &&
        Number(this.strCache.mtimeMs) === stat.mtimeMs &&
        Number(this.strCache.size) === stat.size
      ) {
        this.dailySummary = this.strCache.summary;
        return;
      }

      this.dailySummary = await parseSTRFileAsync(strPath);
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

    const dateDirs = (await fs.promises.readdir(datalogPath))
      .filter((d) => /^\d{8}$/.test(d))
      .sort()
      .reverse();

    this.sessions = [];
    for (const dateDir of dateDirs) {
      const datePath = path.join(datalogPath, dateDir);
      const files = await fs.promises.readdir(datePath);
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
          session.durationMinutes = await this.getSessionDuration(session.files.BRP);
        }
      }

      this.sessions.push(...sessionMap.values());
    }

    this.sleepNightUsage = this.calculateSleepNightUsage();
    this.nightlySessionMetrics = null;
  }

  async getSessionDuration(brpFilePath) {
    try {
      const buffer = await fs.promises.readFile(brpFilePath);
      const numDataRecords = parseInt(buffer.slice(236, 244).toString("ascii").trim(), 10) || 0;
      const dataRecordDuration = parseFloat(buffer.slice(244, 252).toString("ascii").trim()) || 0;
      return (numDataRecords * dataRecordDuration) / 60;
    } catch {
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

  getSleepNightKey(timestamp, { timeZone = this.timeZone } = {}) {
    const sessionDate = new Date(timestamp instanceof Date ? timestamp.getTime() : timestamp);
    if (Number.isNaN(sessionDate.getTime())) {
      return null;
    }

    const boundaryHour = clampBoundaryHour(this.dayStartHour);
    const zoned = getZonedDateParts(sessionDate, normalizeTimeZone(timeZone));
    let { year, month, day } = zoned;

    if (zoned.hour < boundaryHour) {
      ({ year, month, day } = addDaysToDateParts(year, month, day, -1));
    }

    return formatDateParts(year, month, day);
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

  getNearbySessionFiles(session, windowSeconds = 120) {
    if (!session?.timestamp) {
      return session?.files || {};
    }

    const sessionTime = new Date(session.timestamp).getTime();
    if (!Number.isFinite(sessionTime)) {
      return session.files || {};
    }

    const combinedFiles = { ...session.files };
    const nearby = this.sessions
      .filter((candidate) => candidate.id !== session.id && candidate.date === session.date && candidate.timestamp)
      .map((candidate) => ({
        candidate,
        deltaSeconds: Math.abs(new Date(candidate.timestamp).getTime() - sessionTime) / 1000
      }))
      .filter(({ deltaSeconds }) => Number.isFinite(deltaSeconds) && deltaSeconds <= windowSeconds)
      .sort((a, b) => a.deltaSeconds - b.deltaSeconds);

    for (const { candidate } of nearby) {
      for (const [fileType, filePath] of Object.entries(candidate.files || {})) {
        if (!combinedFiles[fileType]) {
          combinedFiles[fileType] = filePath;
        }
      }
    }

    return combinedFiles;
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

    for (const [fileType, filePath] of Object.entries(this.getNearbySessionFiles(session))) {
      try {
        const parsed = parseSessionFile(filePath);
        const rawData = {};
        const signalMeta = {};
        for (const [label, values] of Object.entries(parsed.data)) {
          const sampled = downsampleSignal(values);
          rawData[label] = sampled.values;
          signalMeta[label] = {
            downsampled: sampled.downsampled,
            originalLength: sampled.originalLength,
            stride: sampled.stride
          };
        }
        detail.data[fileType] = {
          header: parsed.header,
          signals: parsed.signals.map((s) => s.label),
          sampleCounts: Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v.length])),
          signalMeta,
          rawData
        };
      } catch (error) {
        detail.data[fileType] = { error: error.message };
      }
    }

    return detail;
  }

  async buildNightlySessionMetrics(onProgress, skipDates = new Set(), cachedSessionMetrics = new Map()) {
    if (this.nightlySessionMetrics) {
      return this.nightlySessionMetrics;
    }

    const { supportsOximetry } = this.getDeviceCapabilities();
    const sessionsByNight = new Map();
    for (const session of this.sessions) {
      const nightKey = this.getSleepNightKey(session.timestamp);
      if (!nightKey) continue;
      if (!sessionsByNight.has(nightKey)) {
        sessionsByNight.set(nightKey, []);
      }
      sessionsByNight.get(nightKey).push(session);
    }

    const nightlySessionMetrics = new Map(cachedSessionMetrics);
    let skippedUnsupportedSa2 = false;
    const total = this.sessions.length;
    let done = 0;

    for (const [nightKey, sessions] of sessionsByNight.entries()) {
      // Skip EDF file I/O for nights whose session metrics are already stored
      // and whose date folder hasn't changed (tracked by mtime in Fix 1).
      if (skipDates.has(nightKey)) {
        done += sessions.length;
        if (onProgress) onProgress({ done, total });
        continue;
      }

      const aggregate = {
        leakSamples: [],
        tidalSamples: [],
        minVentSamples: [],
        respRateSamples: [],
        flowLimSamples: [],
        snoreSamples: [],
        pressureSamples: [],
        spo2Samples: [],
        pulseSamples: [],
        annotations: []
      };

      for (const session of sessions) {
        if (session.files.PLD) {
          try {
            const pld = await parseSessionFileAsync(session.files.PLD);
            aggregate.leakSamples.push(...(pld.data["Leak.2s"] || []));
            aggregate.tidalSamples.push(...(pld.data["TidVol.2s"] || []));
            aggregate.minVentSamples.push(...(pld.data["MinVent.2s"] || []));
            aggregate.respRateSamples.push(...(pld.data["RespRate.2s"] || []));
            aggregate.flowLimSamples.push(...(pld.data["FlowLim.2s"] || []));
            aggregate.snoreSamples.push(...(pld.data["Snore.2s"] || []));
            // MaskPress.2s is actual delivered mask pressure — used for histogram and efficiency
            aggregate.pressureSamples.push(...(pld.data["MaskPress.2s"] || pld.data["Press.2s"] || []));
          } catch (error) {
            safeInfo(console, `[session-parse] Failed PLD parse for ${session.id}: ${error.message}`);
          }
        }

        if (session.files.SA2 && supportsOximetry) {
          try {
            const sa2 = await parseSessionFileAsync(session.files.SA2);
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
            const eve = await parseSessionFileAsync(session.files.EVE);
            aggregate.annotations.push(...(eve.data["EDF Annotations"] || []));
          } catch (error) {
            safeInfo(console, `[session-parse] Failed EVE parse for ${session.id}: ${error.message}`);
          }
        }

        done++;
        if (onProgress) onProgress({ done, total });
        // Yield to the event loop so IPC and renderer remain responsive
        await new Promise((resolve) => setImmediate(resolve));
      }

      nightlySessionMetrics.set(nightKey, summarizeNightlySessionMetrics(aggregate));
    }

    this.nightlySessionMetrics = nightlySessionMetrics;

    if (skippedUnsupportedSa2) {
      safeInfo(
        console,
        `[session-parse] Skipped SA2 parsing for ${this.deviceInfo?.productName || "device"} because onboard oximetry is unsupported for this device class`
      );
    }

    return this.nightlySessionMetrics;
  }

  async getDailyStats(onProgress, skipDates = new Set(), cachedSessionMetrics = new Map()) {
    if (!this.dailySummary || !this.dailySummary.days) {
      return [];
    }

    const { supportsOximetry } = this.getDeviceCapabilities();
    const nightlySessionMetrics = await this.buildNightlySessionMetrics(onProgress, skipDates, cachedSessionMetrics);

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

        // MaskPress.50/95 are actual delivered pressure percentiles from the device.
        // Fall back to configured settings only when delivered stats are absent.
        const maskPressP50 = this.pickPositiveMetric(day["MaskPress.50"]);
        const maskPressP95 = this.pickPositiveMetric(day["MaskPress.95"]);
        const configuredMinPress = this.pickPositiveMetric(day["S.C.Press"], day["S.A.MinPress"], day["S.AS.MinPress"]);
        const configuredMaxPress = this.pickPositiveMetric(day["S.A.MaxPress"], day["S.AFH.MaxPress"], day["S.C.Press"]);
        const mappedPressure = maskPressP50 ?? configuredMinPress;
        const mappedMaxPressure = maskPressP95 ?? configuredMaxPress;

        const respRate50 = this.pickPositiveMetric(day["RespRate.50"]);
        const respRate95 = this.pickPositiveMetric(day["RespRate.95"]);

        return {
          date: dateStr || `Day ${index + 1}`,
          ahi: toOptionalNumber(day.AHI) ?? 0,
          ai: toOptionalNumber(day.AI) ?? 0,
          hi: toOptionalNumber(day.HI) ?? 0,
          oai: toOptionalNumber(day.OAI) ?? 0,
          cai: toOptionalNumber(day.CAI) ?? 0,
          uai: toOptionalNumber(day.UAI) ?? 0,
          rin: toOptionalNumber(day.RIN),
          csr: toOptionalNumber(day.CSR),
          duration: toOptionalNumber(day.Duration) ?? 0,
          onDuration: toOptionalNumber(day.OnDuration) ?? 0,
          usageHours: usageMinutes / 60,
          patientHoursCumulative: toOptionalNumber(day.PatientHours) ?? 0,
          leak50: sessionMetrics?.leak50 ?? leak50.value,
          leak95: sessionMetrics?.leak95 ?? leak95.value,
          leakMax: sessionMetrics?.leakMax ?? leakMax.value,
          leakSpikeCount: sessionMetrics?.leakSpikeCount ?? null,
          pressure: mappedPressure,
          maxPressure: mappedMaxPressure,
          minVent50: sessionMetrics?.minVent50 ?? this.pickPositiveMetric(day["MinVent.50"]),
          minVent95: sessionMetrics?.minVent95 ?? this.pickPositiveMetric(day["MinVent.95"]),
          tidVol50: sessionMetrics?.tidVol50 ?? tidVol50.value,
          tidVol95: sessionMetrics?.tidVol95 ?? tidVol95.value,
          respRate50: sessionMetrics?.respRate50 ?? respRate50,
          respRate95: sessionMetrics?.respRate95 ?? respRate95,
          flowLimP95: sessionMetrics?.flowLimP95 ?? null,
          snoreIndex: sessionMetrics?.snoreIndex ?? null,
          pressureHistogram: sessionMetrics?.pressureHistogram ?? null,
          pressureEfficiency: sessionMetrics?.pressureEfficiency ?? null,
          eventClusterIndexSource: sessionMetrics?.eventClusterIndexSource ?? null,
          pbEpisodeCount: sessionMetrics?.periodicBreathing?.episodeCount ?? null,
          pbTotalSeconds: sessionMetrics?.periodicBreathing?.totalPBSeconds ?? null,
          pbPct: sessionMetrics?.periodicBreathing?.pbPct ?? null,
          pbAvgCycleSec: sessionMetrics?.periodicBreathing?.avgCycleSec ?? null,
          pbIsSignificant: sessionMetrics?.periodicBreathing?.isClinicallySignificant ?? null,
          pbLeakConfounded: sessionMetrics?.periodicBreathing?.leakConfounded ?? null,
          sampleCounts: sessionMetrics?.sampleCounts ?? null,
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
      .filter((day) => day.duration > 0 || day.onDuration > 0 || day.usageHours > 0);

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

  async getSummary(onProgress, skipDates = new Set(), cachedSessionMetrics = new Map()) {
    const stats = await this.getDailyStats(onProgress, skipDates, cachedSessionMetrics);
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
      deviceInfo: {
        manufacturer: this.manufacturer,
        ...(this.deviceInfo || {})
      },
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

function normalizeTimeZone(timeZone) {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    return null;
  }
  const trimmed = timeZone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return null;
  }
}

function clampBoundaryHour(hour) {
  const numeric = Number(hour);
  if (!Number.isFinite(numeric)) {
    return 12;
  }
  return Math.max(0, Math.min(23, Math.trunc(numeric)));
}

function getZonedDateParts(date, timeZone) {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours()
    };
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour)
  };
}

function addDaysToDateParts(year, month, day, deltaDays) {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

module.exports = {
  CPAPDataLoader,
  inferDeviceCapabilities,
  normalizeTimeZone,
  getZonedDateParts
};
