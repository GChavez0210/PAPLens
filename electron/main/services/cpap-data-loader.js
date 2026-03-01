const fs = require("fs");
const path = require("path");
const { parseSTRFile, parseSessionFile } = require("../parsers/edf-parser");

class CPAPDataLoader {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.deviceInfo = null;
    this.dailySummary = null;
    this.sessions = [];
    this.dayStartHour = 12;
    this.dayEndHour = 12;
  }

  setDayBoundary(startHour, endHour) {
    this.dayStartHour = startHour;
    this.dayEndHour = endHour;
    this.sleepNightUsage = this.calculateSleepNightUsage();
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
      const sessionDate = new Date(session.timestamp);
      const sleepNightDate = new Date(sessionDate);
      if (sessionDate.getHours() < this.dayStartHour) {
        sleepNightDate.setDate(sleepNightDate.getDate() - 1);
      }
      const dateKey = sleepNightDate.toISOString().split("T")[0];
      if (!sleepNights.has(dateKey)) {
        sleepNights.set(dateKey, { date: dateKey, totalMinutes: 0, sessionCount: 0 });
      }
      const night = sleepNights.get(dateKey);
      night.totalMinutes += session.durationMinutes;
      night.sessionCount++;
    }
    return sleepNights;
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

  getDailyStats() {
    if (!this.dailySummary || !this.dailySummary.days) {
      return [];
    }

    return this.dailySummary.days
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
        const usageMinutes = sleepNight ? sleepNight.totalMinutes : day.OnDuration || 0;

        return {
          date: dateStr || `Day ${index + 1}`,
          ahi: day.AHI || 0,
          ai: day.AI || 0,
          hi: day.HI || 0,
          oai: day.OAI || 0,
          cai: day.CAI || 0,
          uai: day.UAI || 0,
          duration: day.Duration || 0,
          onDuration: day.OnDuration || 0,
          usageHours: usageMinutes / 60,
          patientHoursCumulative: day.PatientHours || 0,
          leak50: day["Leak.50"] || 0,
          leak95: day["Leak.95"] || 0,
          leakMax: day["Leak.Max"] || 0,
          pressure: day["S.C.Press"] || day["S.AS.MinPress"] || 0,
          maxPressure: day["S.AS.MaxPress"] || day["S.C.Press"] || 0,
          minVent50: day["MinVent.50"] || 0,
          minVent95: day["MinVent.95"] || 0,
          tidVol50: day["TidVol.50"] || 0,
          tidVol95: day["TidVol.95"] || 0,
          spo2Avg: day["SpO2.Avg"] || day.SpO2Avg || day["SpO2.50"] || 0,
          pulseAvg: day["Pulse.Avg"] || day.PulseAvg || day["Pulse.50"] || 0,
          raw: day
        };
      })
      .filter((day) => day.duration > 0 || day.onDuration > 0);
  }

  getSummary() {
    const stats = this.getDailyStats();
    // Assuming stats are chronologically ordered newest-first or oldest-first, let's reverse to ensure we get newest if needed, or just take slice(-30) if oldest first. 
    // Wait, the previous code was slice(0, 30). Let's stick with that but make it robust.
    const recentDays = stats.slice(-30);

    const calcAvg = (field) => {
      if (recentDays.length === 0) return 0;
      return recentDays.reduce((sum, d) => sum + (d[field] || 0), 0) / recentDays.length;
    };

    return {
      deviceInfo: this.deviceInfo,
      totalDays: stats.length,
      recentDays: recentDays.length,
      averages: {
        ahi: calcAvg('ahi'),
        usage: calcAvg('usageHours'),
        pressure: calcAvg('maxPressure'),
        leak: calcAvg('leak95'),
        flowRate: calcAvg('minVent95'),
        tidalVolume: calcAvg('tidVol95')
      },
      dailyStats: stats,
      sessions: this.sessions.slice(0, 50)
    };
  }
}

module.exports = { CPAPDataLoader };
