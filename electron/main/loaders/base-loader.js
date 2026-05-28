"use strict";

class BaseLoader {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.manufacturer = "Unknown";
    this.deviceInfo = null;
    this.sessions = [];
  }

  // Subclasses return true if sdCardPath looks like their device's SD card
  static detect() {
    return false;
  }

  // Returns the same shape as CPAPDataLoader.getSummary()
  async loadAll() {
    throw new Error(`${this.constructor.name}.loadAll() not implemented`);
  }

  async loadSessionDetail() {
    return { error: "Session waveform viewer not yet supported for this device type." };
  }

  getDeviceCapabilities() {
    return { supportsOximetry: false };
  }

  static percentile(sortedArr, p) {
    if (!sortedArr || !sortedArr.length) return null;
    const idx = (p / 100) * (sortedArr.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
  }

  buildSummary(deviceInfo, dailyStats) {
    const normalizedDeviceInfo = {
      manufacturer: this.manufacturer,
      ...(deviceInfo || {})
    };
    const recent = dailyStats.slice(-30);
    const avg = (field) => {
      const vals = recent.map(d => d[field]).filter(v => v != null && Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const leak = avg("leak95");
    const tidalVolume = avg("tidVol50");

    return {
      deviceInfo: normalizedDeviceInfo,
      deviceCapabilities: this.getDeviceCapabilities(),
      totalDays: dailyStats.length,
      recentDays: recent.length,
      averages: {
        ahi: avg("ahi"),
        usage: avg("usageHours"),
        pressure: avg("maxPressure"),
        leak,
        flowRate: avg("minVent95"),
        tidalVolume
      },
      metricSummary: { leak, tidalVolume },
      dailyStats,
      sessions: this.sessions
    };
  }

  blankDay(dateStr) {
    return {
      date: dateStr,
      ahi: 0, ai: 0, hi: 0, oai: 0, cai: 0, uai: 0, rin: null, csr: null,
      duration: 0, onDuration: 0, usageHours: 0, patientHoursCumulative: 0,
      leak50: null, leak95: null, leakMax: null, leakSpikeCount: null,
      pressure: null, maxPressure: null,
      minVent50: null, minVent95: null,
      tidVol50: null, tidVol95: null,
      respRate50: null, respRate95: null,
      flowLimP95: null, snoreIndex: null,
      pressureHistogram: null, pressureEfficiency: null,
      eventClusterIndexSource: null,
      pbEpisodeCount: null, pbTotalSeconds: null,
      pbPct: null, pbAvgCycleSec: null, pbIsSignificant: null,
      spo2Avg: null, pulseAvg: null,
      raw: {}, sourceMetrics: {}
    };
  }
}

module.exports = { BaseLoader };
