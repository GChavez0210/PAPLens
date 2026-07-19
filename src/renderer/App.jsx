import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "chart.js";
import { TrendChart } from "./charts/TrendChart";
import { LastNightDetails } from "./components/LastNightDetails";
import { ProfileSelector } from "./components/ProfileSelector";
import { ClinicalSummaryCard } from "./components/ClinicalSummaryCard";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SessionGraphsModal } from "./components/SessionGraphsModal";
import { SleepCalendar } from "./components/SleepCalendar";
import {
  IconDashboard,
  IconCalendar,
  IconChart,
  IconSun,
  IconMoon,
  IconRefresh,
  IconFileText,
  IconImport,
  IconSwitch,
  IconMonitor,
  IconHash,
  IconCpu
} from "./components/Icons";
import { ScoreRing } from "./components/ScoreRing";
import { InfoTip } from "./components/InfoTip";
import { SkeletonPanel } from "./components/Skeleton";
import {
  buildClinicalContext,
  buildReportProfile,
  computeScores,
  filterAnalyzedDays,
  filterUsageTrackedDays,
  getCorrelationInsight,
  hasTherapyData,
  isNoDataDay
} from "./utils/reportBuilder";
import { toMetricNumber } from "./utils/therapyMetrics";
import { downsampleIndices } from "./utils/downsample";
import { AHI_MILD, AHI_MODERATE, LEAK_HIGH, USAGE_COMPLIANCE_HOURS } from "./constants";
import { ThemeContext } from "./ThemeContext";

const RANGE_OPTIONS = [
  { value: "7", label: "7" },
  { value: "30", label: "30" },
  { value: "90", label: "90" },
  { value: "custom", label: "Custom" }
];

/** Shared style for the "PAPLens by Gabriel Chavez" footer credit line. */
const FOOTER_CREDIT_STYLE = {
  textAlign: "center",
  padding: "16px 0 4px",
  fontSize: "0.7rem",
  color: "var(--muted)",
  opacity: 0.55
};
const OXIMETRY_UNSUPPORTED_PRODUCT_PATTERN = /(airsense|aircurve|lumis|airmini)/i;
const Insights = lazy(() => import("./pages/Insights").then((module) => ({ default: module.Insights })));

/**
 * Period-over-period change indicator. Renders nothing when either side of
 * the comparison is unavailable (e.g. "all"/"custom" ranges have no prior window).
 */
function MetricDelta({ current, prior, goodWhenDown = false, decimals = 1, periodLabel = "prior period" }) {
  if (current == null || prior == null) return null;
  const delta = current - prior;
  const eps = Math.pow(10, -decimals) / 2;
  if (Math.abs(delta) < eps) {
    return <span className="metric-delta delta-flat">steady vs {periodLabel}</span>;
  }
  const improved = goodWhenDown ? delta < 0 : delta > 0;
  return (
    <span className={`metric-delta ${improved ? "delta-good" : "delta-bad"}`}>
      {delta < 0 ? "↓" : "↑"} {Math.abs(delta).toFixed(decimals)} vs {periodLabel}
    </span>
  );
}

function dayKeyFromSession(session) {
  if (!session?.timestamp) {
    return "";
  }
  const date = new Date(session.timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().split("T")[0];
}

function parseImportTimestamp(value) {
  if (!value) return null;
  const normalized =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatImportTimestamp(value) {
  const date = parseImportTimestamp(value);
  if (!date) return "Not imported yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function getChartCanvasByKey(reportKey) {
  return document.querySelector(`[data-report-key="${reportKey}"] canvas`);
}

function captureChartDataUri(canvas) {
  if (!canvas) return null;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) {
    return canvas.toDataURL("image/png");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(canvas, 0, 0);
  return exportCanvas.toDataURL("image/png");
}

function dismissBootSplash() {
  document.body.classList.add("app-mounted");
  window.setTimeout(() => {
    document.getElementById("app-boot-splash")?.setAttribute("hidden", "hidden");
  }, 280);
}

function LoadingScreen({ logoSrc, status }) {
  return (
    <main className="boot-shell" aria-busy="true" aria-live="polite">
      <section className="boot-card">
        <div className="boot-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <img className="boot-logo" src={logoSrc} alt="PAPLens" />
        <div className="boot-copy">
          <h1>Preparing your therapy data</h1>
          <p>{status}</p>
        </div>
        <div className="boot-progress" aria-hidden="true">
          <span />
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [activeProfile, setActiveProfile] = useState(null);
  const [activeTab, setActiveTab] = useState("overview"); // overview or insights
  const [summary, setSummary] = useState(null);
  const [lastNight, setLastNight] = useState(null);
  const [status, setStatus] = useState("Loading...");
  const [isBooting, setIsBooting] = useState(true);
  const [range, setRange] = useState("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dayStartHour, setDayStartHour] = useState(12);
  const [sleepTimeZone, setSleepTimeZone] = useState(() => localStorage.getItem("paplens-sleep-timezone") || "");
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalSessions, setModalSessions] = useState([]);
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [dataLoadingMessage, setDataLoadingMessage] = useState("");
  const [importProgress, setImportProgress] = useState(null);
  const [isReportGenerating, setIsReportGenerating] = useState(false);
  const [showDeviceTip, setShowDeviceTip] = useState(false);
  const [showReportTip, setShowReportTip] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const hasBootstrappedRef = useRef(false);
  const deviceTipRef = useRef(null);
  const aboutCloseButtonRef = useRef(null);
  const aboutPreviousFocusRef = useRef(null);

  const [theme, setTheme] = useState(() => localStorage.getItem("paplens-theme") || "dark");
  const bootLogoSrc =
    theme === "light"
      ? new URL("./assets/PLLogoL.png", import.meta.url).href
      : new URL("./assets/PLLogoD.png", import.meta.url).href;

  useEffect(() => {
    if (theme === "light") {
      document.body.classList.add("light-mode");
    } else {
      document.body.classList.remove("light-mode");
    }
  }, [theme]);

  useEffect(() => {
    const unsub = window.cpapAPI.onShowAbout(() => {
      aboutPreviousFocusRef.current = document.activeElement;
      setShowAboutModal(true);
    });
    return unsub;
  }, []);

  // Dismiss the device-detected popover when clicking outside it or pressing Escape.
  useEffect(() => {
    if (!showDeviceTip) return;
    const handlePointer = (event) => {
      if (deviceTipRef.current && !deviceTipRef.current.contains(event.target)) {
        setShowDeviceTip(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setShowDeviceTip(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showDeviceTip]);

  // Last-night overview powers both the dashboard hero (score ring + the
  // last-night column of the comparison table) and the detail card below it.
  useEffect(() => {
    const loadLastNight = async () => {
      const res = await window.cpapAPI.getLastNightOverview();
      if (res) setLastNight(res);
    };
    queueMicrotask(() => {
      void loadLastNight();
    });
    const unsub = window.cpapAPI.onDataLoaded(() => loadLastNight());
    return () => unsub();
  }, []);

  useEffect(() => {
    if (showAboutModal && aboutCloseButtonRef.current) {
      aboutCloseButtonRef.current.focus();
    } else if (!showAboutModal && aboutPreviousFocusRef.current) {
      aboutPreviousFocusRef.current.focus();
      aboutPreviousFocusRef.current = null;
    }
  }, [showAboutModal]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("paplens-theme", next);
      return next;
    });
  };

  const loadCurrent = useCallback(async () => {
    try {
      const current = await window.cpapAPI.getSummary();
      if (current) {
        setSummary(current);
        setStatus(current.totalDays > 0 ? `Loaded ${current.totalDays} nights from database` : "Loaded from database");
        return true;
      }
      setSummary(null);
      setStatus("Import a CPAP folder or SD card to add data");
      return false;
    } catch (error) {
      console.error("Failed to load summary", error);
      setSummary(null);
      setStatus("Unable to load your saved data");
      return false;
    }
  }, []);

  const loadCurrentProfile = useCallback(async () => {
    try {
      const profile = await window.cpapAPI.getActiveProfile();
      setActiveProfile(profile);
      if (!profile) {
        setSummary(null);
        setStatus("Select a profile");
        return;
      }
      await loadCurrent();
    } catch (error) {
      console.error("Failed to load active profile", error);
      setSummary(null);
      setStatus("Unable to load your saved data");
    }
  }, [loadCurrent]);

  useEffect(() => {
    document.body.classList.add("app-mounted");
  }, []);

  useEffect(() => {
    if (hasBootstrappedRef.current) {
      return undefined;
    }
    hasBootstrappedRef.current = true;

    const bootstrap = async () => {
      await loadCurrentProfile();
      setIsBooting(false);
      dismissBootSplash();
    };

    bootstrap();
    const unsubscribe = window.cpapAPI.onDataLoaded((data) => {
      setSummary(data);
      setStatus("Loaded");
    });
    const unsubscribeProgress = window.cpapAPI.onImportProgress((progress) => {
      setImportProgress(progress);
    });

    return () => {
      unsubscribe();
      unsubscribeProgress();
    };
  }, [loadCurrentProfile]);

  const deviceInfo = summary?.deviceInfo || {};
  const supportsOximetry = useMemo(() => {
    if (summary?.deviceCapabilities?.supportsOximetry !== undefined) {
      return summary.deviceCapabilities.supportsOximetry;
    }

    return !OXIMETRY_UNSUPPORTED_PRODUCT_PATTERN.test(deviceInfo.productName || "");
  }, [deviceInfo.productName, summary?.deviceCapabilities?.supportsOximetry]);

  // Feature flags — undefined means ResMed (full support); explicit false hides the chart.
  const caps = summary?.deviceCapabilities || {};
  const supportsAHI = caps.supportsAHI ?? true;
  const supportsLeakPercentiles = caps.supportsLeakPercentiles ?? true;
  const supportsVentilation = caps.supportsVentilation ?? true;

  const stats = useMemo(() => summary?.dailyStats || [], [summary?.dailyStats]);

  const filteredStats = useMemo(() => {
    if (!stats.length) return [];
    const sortedStats = [...stats].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (range === "all") {
      return sortedStats;
    }
    if (range === "custom") {
      if (!customFrom || !customTo) return sortedStats;
      const from = new Date(customFrom).getTime();
      const to = new Date(customTo).getTime();
      return sortedStats.filter((d) => {
        const t = new Date(d.date).getTime();
        return t >= from && t <= to;
      });
    }
    const days = parseInt(range, 10);
    if (Number.isNaN(days)) return sortedStats;
    return sortedStats.slice(-days);
  }, [stats, range, customFrom, customTo]);

  const analyzedStats = useMemo(() => filterAnalyzedDays(filteredStats), [filteredStats]);
  const usageTrackedStats = useMemo(() => filterUsageTrackedDays(filteredStats), [filteredStats]);

  // Equal-length window immediately before the selected range, for
  // period-over-period deltas. Empty for "all"/"custom" ranges.
  const priorRangeStats = useMemo(() => {
    const days = parseInt(range, 10);
    if (Number.isNaN(days) || !stats.length) return [];
    const sorted = [...stats].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (sorted.length <= days) return [];
    return sorted.slice(-(days * 2), -days);
  }, [stats, range]);
  const priorAnalyzedStats = useMemo(() => filterAnalyzedDays(priorRangeStats), [priorRangeStats]);
  const priorUsageTrackedStats = useMemo(() => filterUsageTrackedDays(priorRangeStats), [priorRangeStats]);

  const trendsData = useMemo(() => {
    const toTrendValue = (day, selector) => (hasTherapyData(day) ? selector(day) : null);
    const ahiArr = filteredStats.map((d) => toTrendValue(d, (day) => day.ahi));
    // Compute rolling averages BEFORE downsampling so they remain accurate
    const rolling7 = ahiArr.map((_, i) => {
      const slice = ahiArr
        .slice(0, i + 1)
        .filter((value) => value != null)
        .slice(-7);
      if (!slice.length) return null;
      return parseFloat((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
    });
    const n = filteredStats.length;

    const allSeries = {
      labels: filteredStats.map((d) => d.date),
      ahi: ahiArr,
      ai: filteredStats.map((d) => toTrendValue(d, (day) => day.ai)),
      hi: filteredStats.map((d) => toTrendValue(d, (day) => day.hi)),
      cai: filteredStats.map((d) => toTrendValue(d, (day) => day.cai)),
      usage: filteredStats.map((d) => toTrendValue(d, (day) => day.usageHours)),
      leak50: filteredStats.map((d) => toTrendValue(d, (day) => day.leak50)),
      leak95: filteredStats.map((d) => toTrendValue(d, (day) => day.leak95)),
      pressure: filteredStats.map((d) => toTrendValue(d, (day) => day.pressure)),
      maxPressure: filteredStats.map((d) => toTrendValue(d, (day) => day.maxPressure)),
      pressureVarIndex: filteredStats.map((d) =>
        toTrendValue(d, (day) => parseFloat(((day.maxPressure || 0) - (day.pressure || 0)).toFixed(2)))
      ),
      minVent50: filteredStats.map((d) => toTrendValue(d, (day) => day.minVent50)),
      minVent95: filteredStats.map((d) => toTrendValue(d, (day) => day.minVent95)),
      tidVol50: filteredStats.map((d) => toTrendValue(d, (day) => day.tidVol50)),
      tidVol95: filteredStats.map((d) => toTrendValue(d, (day) => day.tidVol95)),
      respRate: filteredStats.map((d) => toTrendValue(d, (day) => day.respRate50)),
      spo2: filteredStats.map((d) => toTrendValue(d, (day) => day.spo2Avg)),
      pulse: filteredStats.map((d) => toTrendValue(d, (day) => day.pulseAvg)),
      rolling7Ahi: rolling7,
      ahiThreshold: Array(n).fill(5),
      leakThreshold: Array(n).fill(24)
    };

    // Downsample long ranges to keep chart rendering snappy
    if (n > 400) {
      const indices = downsampleIndices(n, 300);
      const pick = (arr) => Array.from(indices, (i) => arr[i]);
      return {
        labels: pick(allSeries.labels),
        ahi: pick(allSeries.ahi),
        ai: pick(allSeries.ai),
        hi: pick(allSeries.hi),
        cai: pick(allSeries.cai),
        usage: pick(allSeries.usage),
        leak50: pick(allSeries.leak50),
        leak95: pick(allSeries.leak95),
        pressure: pick(allSeries.pressure),
        maxPressure: pick(allSeries.maxPressure),
        pressureVarIndex: pick(allSeries.pressureVarIndex),
        minVent50: pick(allSeries.minVent50),
        minVent95: pick(allSeries.minVent95),
        tidVol50: pick(allSeries.tidVol50),
        tidVol95: pick(allSeries.tidVol95),
        respRate: pick(allSeries.respRate),
        spo2: pick(allSeries.spo2),
        pulse: pick(allSeries.pulse),
        rolling7Ahi: pick(allSeries.rolling7Ahi),
        ahiThreshold: pick(allSeries.ahiThreshold),
        leakThreshold: pick(allSeries.leakThreshold)
      };
    }

    return allSeries;
  }, [filteredStats]);

  const overviewChartDatasets = useMemo(() => {
    // Missing/no-therapy days come through as null. Drop the metric lines to the
    // baseline (0) on those days instead of leaving broken gaps. Rolling averages
    // and constant threshold lines are intentionally left as-is.
    const zf = (arr) => (arr || []).map((value) => (value == null ? 0 : value));
    return {
      ahi: [
        {
          label: "Total AHI",
          data: zf(trendsData.ahi),
          borderColor: "#ef4444",
          fill: true,
          backgroundColor: "rgba(239,68,68,0.18)"
        },
        { label: "Central (CAI)", data: zf(trendsData.cai), borderColor: "#f59e0b" },
        { label: "Obstructive (OAI/AI)", data: zf(trendsData.ai), borderColor: "#3b82f6" },
        { label: "Hypopnea (HI)", data: zf(trendsData.hi), borderColor: "#8b5cf6" },
        {
          label: "7-Day Avg",
          data: trendsData.rolling7Ahi,
          borderColor: "#22d3ee",
          borderWidth: 2,
          borderDash: [4, 4],
          pointRadius: 0
        },
        {
          label: "AHI = 5 Threshold",
          data: trendsData.ahiThreshold,
          borderColor: "rgba(239,68,68,0.8)",
          borderWidth: 1.5,
          borderDash: [8, 4],
          pointRadius: 0,
          fill: false
        }
      ],
      leak: [
        { label: "Maximum Leak (95th)", data: zf(trendsData.leak95), borderColor: "#ef4444", borderDash: [5, 5] },
        {
          label: "Median Leak",
          data: zf(trendsData.leak50),
          borderColor: "#3b82f6",
          fill: true,
          backgroundColor: "rgba(59,130,246,0.25)"
        },
        {
          label: "24 L/min Critical Limit",
          data: trendsData.leakThreshold,
          borderColor: "rgba(239,68,68,0.8)",
          borderWidth: 1.5,
          borderDash: [8, 4],
          pointRadius: 0,
          fill: false
        }
      ],
      pressure: [
        { label: "95th Percentile", data: zf(trendsData.maxPressure), borderColor: "#f59e0b" },
        {
          label: "Median Delivery",
          data: zf(trendsData.pressure),
          borderColor: "#10b981",
          fill: true,
          backgroundColor: "rgba(16,185,129,0.2)"
        },
        {
          label: "Variability Index (P95-P50)",
          data: zf(trendsData.pressureVarIndex),
          borderColor: "#8b5cf6",
          borderDash: [3, 3],
          pointRadius: 0
        }
      ],
      flow: [
        { label: "Min Vent 95%", data: zf(trendsData.minVent95), borderColor: "#8b5cf6", tension: 0.3 },
        { label: "Min Vent 50%", data: zf(trendsData.minVent50), borderColor: "#3b82f6", tension: 0.3 },
        { label: "Resp Rate", data: zf(trendsData.respRate), borderColor: "#f59e0b", yAxisID: "y1" }
      ],
      tidal: [
        { label: "Upper Bound (95%)", data: zf(trendsData.tidVol95), borderColor: "#f59e0b", borderDash: [5, 5] },
        {
          label: "Median Efficacy",
          data: zf(trendsData.tidVol50),
          borderColor: "#8b5cf6",
          fill: true,
          backgroundColor: "rgba(139, 92, 246, 0.1)"
        }
      ],
      usage: [
        {
          label: "Usage Hours",
          data: zf(trendsData.usage),
          backgroundColor: "rgba(16, 185, 129, 0.55)",
          hoverBackgroundColor: "rgba(16, 185, 129, 0.8)"
        }
      ],
      // SpO2/pulse baseline is ~95%/60bpm, not 0 — a missing day means the oximeter
      // wasn't worn, so bridge the gap (spanGaps) rather than diving the line to zero.
      oximetry: [
        { label: "SpO2 %", data: trendsData.spo2, borderColor: "#3b82f6", spanGaps: true },
        { label: "Pulse", data: trendsData.pulse, borderColor: "#ef4444", yAxisID: "y1", spanGaps: true }
      ]
    };
  }, [trendsData]);

  const hasOximetryTrend = useMemo(() => trendsData.spo2.some((v) => v > 0), [trendsData.spo2]);

  const chooseFolder = async () => {
    setIsDataLoading(true);
    setImportProgress(null);
    setDataLoadingMessage("Parsing your CPAP data files and running analysis...");
    setStatus("Importing data folder...");
    try {
      const result = await window.cpapAPI.selectDataFolder();
      if (result.success) {
        setSummary(result.summary);
        setStatus(`Imported data from ${result.path}`);
      } else {
        setStatus(result.error);
      }
    } finally {
      setIsDataLoading(false);
      setImportProgress(null);
    }
  };

  const refresh = async () => {
    setIsDataLoading(true);
    setImportProgress(null);
    setDataLoadingMessage("Refreshing therapy data and recomputing metrics...");
    setStatus("Refreshing data...");
    try {
      const result = await window.cpapAPI.refresh();
      if (result.success) {
        setSummary(result.summary);
        setStatus("Refreshed");
      } else {
        setStatus(result.error);
      }
    } finally {
      setIsDataLoading(false);
      setImportProgress(null);
    }
  };

  const saveReport = async () => {
    // (a) Guard: no data in selected range
    if (filteredStats.length === 0) {
      setStatus("Cannot save report: no data in selected date range.");
      return;
    }

    setIsReportGenerating(true);
    setStatus("Generating PDF report...");

    const prevTab = activeTab;

    /**
     * (b) Poll until the canvases we are about to capture are ready, or a cap
     * is reached. `requiredKeys` must each have a mounted canvas with nonzero
     * dimensions and a live Chart.js instance — this matters when switching to
     * the lazy-loaded Insights tab, whose containers don't exist in the DOM yet
     * (the always-mounted Overview charts would otherwise satisfy a "everything
     * currently present is ready" check immediately and the Insights charts
     * would be captured as null). All other mounted [data-report-key]
     * containers must be ready too.
     */
    const waitForCharts = (requiredKeys = []) =>
      new Promise((resolve) => {
        const CAP_MS = 8000;
        const POLL_MS = 100;
        const start = Date.now();
        const canvasReady = (canvas) =>
          canvas && canvas.width > 0 && canvas.height > 0 && Chart.getChart(canvas) != null;
        const check = () => {
          const requiredReady = requiredKeys.every((key) =>
            canvasReady(document.querySelector(`[data-report-key="${key}"] canvas`))
          );
          const allPresentReady = Array.from(document.querySelectorAll("[data-report-key]")).every((el) =>
            canvasReady(el.querySelector("canvas"))
          );
          if ((requiredReady && allPresentReady) || Date.now() - start >= CAP_MS) {
            resolve();
          } else {
            setTimeout(check, POLL_MS);
          }
        };
        // Single rAF before first poll so the DOM has settled
        requestAnimationFrame(check);
      });

    // Step 1: Switch to insights tab to render and capture those charts.
    // "ahi-trend" always renders once the Insights data arrives; the
    // conditional charts (event-split, flow-limit) mount in the same React
    // commit, so the all-present check above covers them once it exists.
    if (activeTab !== "insights") {
      setActiveTab("insights");
    }
    await waitForCharts(["ahi-trend"]);

    const ahiTrendUri = captureChartDataUri(getChartCanvasByKey("ahi-trend"));
    const eventSplitUri = captureChartDataUri(getChartCanvasByKey("event-split"));
    const flowLimitUri = captureChartDataUri(getChartCanvasByKey("flow-limit"));

    // Step 2: Switch to overview tab to capture the remaining charts.
    // "pressure" and "usage" are always rendered on the overview.
    setActiveTab("overview");
    await waitForCharts(["pressure", "usage"]);

    const charts = {
      ahiDataUri: ahiTrendUri,
      eventSplitDataUri: eventSplitUri,
      flowLimitDataUri: flowLimitUri,
      leakDataUri: captureChartDataUri(getChartCanvasByKey("leak")),
      usageDataUri: captureChartDataUri(getChartCanvasByKey("usage")),
      pressureLeakDataUri: captureChartDataUri(getChartCanvasByKey("pressure")),
      tidalDataUri: captureChartDataUri(getChartCanvasByKey("tidal")),
      ahiCaption: "Nightly AHI bars with 7-day rolling average. Bars colored red when AHI ≥ 5.",
      eventSplitCaption: "Stacked breakdown of obstructive, central, unclassified apneas and hypopneas per hour.",
      flowLimitCaption:
        "Flow Limitation P95 (airway narrowing intensity) and RIN (sub-threshold flow-limited breaths per hr).",
      leakCaption: "Median and 95th percentile mask leak with 24 L/min critical threshold.",
      usageCaption: "Nightly therapy usage hours with compliance threshold at 4 hrs.",
      pressureLeakCaption: "Pressure 50th and 95th percentile delivery with variability index.",
      tidalCaption: "Median and 95th percentile tidal volume per night."
    };

    const reportData = {
      report: {
        generatedAt: new Date().toLocaleString(),
        rangeLabel:
          range === "all" ? "All Time" : range === "custom" ? `${customFrom} to ${customTo}` : `Last ${range} Days`,
        windowDays: range === "all" ? 90 : range === "custom" ? 30 : parseInt(range, 10),
        startDate: range === "custom" ? customFrom : null,
        endDate: range === "custom" ? customTo : null,
        sleepBoundaryLabel: `Noon-to-Noon (Start: ${dayStartHour}:00${sleepTimeZone ? ` ${sleepTimeZone}` : ""})`,
        pageCount: 2,
        footerPage1: "Page 1 of 2",
        footerPage2: "Page 2 of 2"
      },
      profile: buildReportProfile(activeProfile),
      device: {
        model: deviceInfo.productName || "Unknown",
        manufacturer: deviceInfo.manufacturer || "Unknown",
        serialNumber: deviceInfo.serialNumber || "Unknown",
        firmware: deviceInfo.firmwareVersion || "Unknown"
      },
      charts
    };

    const summaryScores = computeScores(analyzedStats);
    if (summaryScores) {
      reportData.summaryScores = summaryScores;
    }

    const clinicalContext = buildClinicalContext(filteredStats, deviceInfo);
    if (clinicalContext) {
      reportData.clinicalContext = clinicalContext;

      const ahiCount = analyzedStats.length || 1;
      const usageCount = usageTrackedStats.length || 1;
      const avgAhi = analyzedStats.reduce((sum, n) => sum + (n.ahi || 0), 0) / ahiCount;
      const avgUsage = usageTrackedStats.reduce((sum, n) => sum + (n.usageHours || 0), 0) / usageCount;

      reportData.summary = {
        avgAhi: avgAhi.toFixed(1),
        ahiStatusClass: avgAhi > AHI_MODERATE ? "bad" : avgAhi > AHI_MILD ? "warn" : "good",
        ahiStatusLabel: avgAhi > AHI_MODERATE ? "Severe" : avgAhi > AHI_MILD ? "Elevated" : "Adequate",
        avgUsage: avgUsage.toFixed(1),
        usageStatusClass: avgUsage < USAGE_COMPLIANCE_HOURS ? "bad" : "good",
        usageStatusLabel: avgUsage < USAGE_COMPLIANCE_HOURS ? "Low Usage" : "Good",
        leakTypical: clinicalContext.leak95th ?? "N/A",
        leakStatusClass:
          clinicalContext.leak95th !== null && parseFloat(clinicalContext.leak95th) > LEAK_HIGH ? "warn" : "good",
        leakStatusLabel:
          clinicalContext.leak95th !== null && parseFloat(clinicalContext.leak95th) > LEAK_HIGH ? "Elevated" : "Normal"
      };
    }

    // Fetch Insights/Correlations inline for the PDF payload builder
    try {
      let insightPayload;
      if (range === "custom") {
        insightPayload = { from: customFrom, to: customTo };
      } else if (range === "all") {
        insightPayload = { days: 0 };
      } else {
        insightPayload = { days: parseInt(range, 10) };
      }

      const insightsData = await window.cpapAPI.getInsights(insightPayload);
      if (insightsData && insightsData.correlations) {
        reportData.correlations = {
          windowDays: insightPayload.days || 90,
          pairs: insightsData.correlations.map((c) => {
            const pairLabel = `${c.x} ↔ ${c.y}`;
            return {
              pair: pairLabel,
              r: Number(c.r).toFixed(2),
              n: c.n || clinicalContext?.nightsAnalyzed || 30,
              label: c.r > 0.4 ? "Positive" : c.r < -0.4 ? "Negative" : "Weak/None",
              plain: getCorrelationInsight(pairLabel, c.r)
            };
          })
        };
      }

      // Augment clinicalContext with new metrics from high-resolution trend data
      if (insightsData && insightsData.trends && reportData.clinicalContext) {
        const trendsWithData = insightsData.trends.filter((d) => (d.usage_hours || 0) > 0);

        const rinNights = trendsWithData.filter((d) => d.rin_per_hr !== null && d.rin_per_hr !== undefined);
        if (rinNights.length > 0) {
          reportData.clinicalContext.avgRin = (
            rinNights.reduce((s, d) => s + d.rin_per_hr, 0) / rinNights.length
          ).toFixed(1);
        }

        const snoreNights = trendsWithData.filter((d) => d.snore_index !== null && d.snore_index !== undefined);
        if (snoreNights.length > 0) {
          reportData.clinicalContext.avgSnoreIndex = (
            snoreNights.reduce((s, d) => s + d.snore_index, 0) / snoreNights.length
          ).toFixed(1);
        }

        const effNights = trendsWithData.filter(
          (d) => d.pressure_efficiency !== null && d.pressure_efficiency !== undefined
        );
        if (effNights.length > 0) {
          reportData.clinicalContext.avgPressureEfficiency = (
            effNights.reduce((s, d) => s + d.pressure_efficiency, 0) / effNights.length
          ).toFixed(1);
        }

        if (insightsData.complianceRate !== null && insightsData.complianceRate !== undefined) {
          reportData.clinicalContext.complianceRate = insightsData.complianceRate;
          reportData.clinicalContext.complianceWindowNights = insightsData.complianceWindowNights;
          reportData.clinicalContext.compliantNights = insightsData.compliantNights;
        }
      }

      if (insightsData && insightsData.explanations && insightsData.explanations.length > 0) {
        const seenKeys = new Set();
        const uniqueFindings = insightsData.explanations.filter((e) => {
          if (seenKeys.has(e.key)) return false;
          seenKeys.add(e.key);
          return true;
        });
        reportData.findings = uniqueFindings.slice(0, 6).map((e) => ({
          title: e.title,
          summary: e.summary
        }));
      }
    } catch (e) {
      console.warn("Could not fetch correlations for pdf report", e);
    }

    const result = await window.cpapAPI.saveReport(reportData);

    // Restore the tab the user was on before the report was triggered
    setActiveTab(prevTab);

    setIsReportGenerating(false);

    if (result.success) {
      setStatus(`Saved to ${result.filePath}`);
    } else {
      setStatus(result.error || "Save report failed");
    }
  };

  const applySleepFilter = async () => {
    const normalizedSleepTimeZone = sleepTimeZone.trim();
    const result = await window.cpapAPI.setTimeFilter(
      Number(dayStartHour),
      Number(dayStartHour),
      normalizedSleepTimeZone || null
    );
    if (result.success) {
      localStorage.setItem("paplens-sleep-timezone", normalizedSleepTimeZone);
      setSummary(result.summary);
      setStatus(
        `Sleep boundary updated: ${dayStartHour}:00 to ${dayStartHour}:00${normalizedSleepTimeZone ? ` ${normalizedSleepTimeZone}` : ""}`
      );
      return;
    }
    setStatus(result.error || "Sleep boundary update failed");
  };

  const sessionsForDay = (day) => {
    if (!summary?.sessions || !day?.date) return [];
    // CPAP files are stored under the night they start (e.g. night of May 9→10 lives in
    // the "20260509" folder) but the calendar labels it "2026-05-10". Check both the
    // calendar date and the preceding calendar day to handle this convention.
    const d = new Date(day.date);
    d.setDate(d.getDate() - 1);
    const prevDate = d.toISOString().split("T")[0];
    return summary.sessions.filter((s) => dayKeyFromSession(s) === day.date || dayKeyFromSession(s) === prevDate);
  };

  const selectDailySession = (day) => {
    setSelectedDay(day);
    if (isNoDataDay(day)) return;

    const daySessions = sessionsForDay(day);
    // Prefer sessions with recorded data (durationMinutes > 0).
    // Fall back to the full list only if every session has 0 duration (edge case).
    const usable = daySessions.filter((s) => s.durationMinutes > 0);
    if (usable.length > 0) {
      setModalSessions(usable);
    } else if (daySessions.length > 0) {
      setModalSessions(daySessions);
    } else {
      // Fallback synthetic session when EDF files aren't available locally
      // (modal will use getBestSessionForDate internally via id=null path)
      setModalSessions([{ id: null, timestamp: day.date, files: {} }]);
    }
    setIsSessionModalOpen(true);
  };

  const lastImportedLine = `Last imported: ${formatImportTimestamp(summary?.lastImportedAt)}`;

  const renderRangeControls = () => (
    <div className="controls range-controls" aria-label="View range">
      <label>View Range:</label>
      <div className="range-group" role="group" aria-label="View range">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`btn-range${range === option.value ? " active" : ""}`}
            aria-pressed={range === option.value}
            onClick={() => setRange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {range === "custom" && (
        <div className="custom-range" aria-label="Custom date range">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}
    </div>
  );

  if (isBooting) {
    return <LoadingScreen logoSrc={bootLogoSrc} status={status} />;
  }

  if (!activeProfile) {
    return <ProfileSelector onSelect={() => loadCurrentProfile()} />;
  }

  return (
    <ThemeContext.Provider value={theme}>
      <main className="app-shell">
        {isDataLoading && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              background: "rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "36px 52px",
                textAlign: "center",
                boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
                maxWidth: 380
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: "3px solid var(--border)",
                  borderTopColor: "#22D3EE",
                  margin: "0 auto 20px",
                  animation: "spin 0.9s linear infinite"
                }}
              />
              <h2 style={{ color: "var(--text)", margin: "0 0 10px", fontSize: "1.15rem", fontWeight: 700 }}>
                Loading Data
              </h2>
              <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.875rem", lineHeight: 1.6 }}>
                {dataLoadingMessage}
              </p>
              {importProgress && importProgress.total > 0 && (
                <div style={{ marginTop: 16, width: "100%" }}>
                  <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.round((importProgress.done / importProgress.total) * 100)}%`,
                        background: "#22D3EE",
                        transition: "width 0.15s ease",
                        borderRadius: 2
                      }}
                    />
                  </div>
                  <p style={{ color: "var(--muted)", margin: "8px 0 0", fontSize: "0.75rem" }}>
                    {importProgress.done} / {importProgress.total} sessions parsed
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        {isReportGenerating && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1001,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              background: "rgba(0,0,0,0.60)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "36px 52px",
                textAlign: "center",
                boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
                maxWidth: 360
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: "3px solid var(--border)",
                  borderTopColor: "#22D3EE",
                  margin: "0 auto 20px",
                  animation: "spin 0.9s linear infinite"
                }}
              />
              <h2 style={{ color: "var(--text)", margin: "0 0 10px", fontSize: "1.15rem", fontWeight: 700 }}>
                Generating Report
              </h2>
              <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.875rem", lineHeight: 1.6 }}>
                Capturing charts and building your PDF&hellip;
              </p>
            </div>
          </div>
        )}
        <header className="top-nav">
          <div className="brand">
            <img
              src={
                theme === "light"
                  ? new URL("./assets/PLLogoL.png", import.meta.url).href
                  : new URL("./assets/PLLogoD.png", import.meta.url).href
              }
              alt="PAPLens"
              style={{ height: "34px", width: "auto" }}
            />
          </div>
          <div className="nav-controls">
            {deviceInfo.productName &&
              (() => {
                const name = (deviceInfo.productName || "").toLowerCase();
                const model = name.includes("11")
                  ? "AirSense 11"
                  : name.includes("10")
                    ? "AirSense 10"
                    : deviceInfo.productName;
                const deviceRows = [
                  { DeviceIcon: IconMonitor, label: "Model", value: deviceInfo.productName || "Unknown" },
                  { DeviceIcon: IconHash, label: "Serial", value: deviceInfo.serialNumber || "Unknown" },
                  { DeviceIcon: IconCpu, label: "Firmware", value: deviceInfo.firmwareVersion || "Unknown" }
                ];
                return (
                  <div className="nav-device" ref={deviceTipRef}>
                    <button
                      type="button"
                      className="nav-chip"
                      aria-expanded={showDeviceTip}
                      aria-controls="device-detected-popover"
                      onClick={() => setShowDeviceTip((isShown) => !isShown)}
                    >
                      <IconMonitor size={15} /> Device Detected: {model}
                    </button>
                    {showDeviceTip && (
                      <div id="device-detected-popover" className="device-popover" role="tooltip">
                        <div className="section-eyebrow">Device Information</div>
                        {deviceRows.map(({ DeviceIcon, label, value }) => (
                          <div key={label} className="device-popover-row">
                            <span className="device-icon">
                              <DeviceIcon size={18} />
                            </span>
                            <div>
                              <div className="device-label">{label}</div>
                              <div className="device-value">{value}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            <button
              className="nav-chip"
              title="Switch profile"
              onClick={async () => {
                await window.cpapAPI.setActiveProfile(null);
                setSummary(null);
                setActiveProfile(null);
              }}
            >
              <span className="chip-avatar">{(activeProfile.name || "?").charAt(0)}</span>
              <strong>{activeProfile.name}</strong>
              {activeProfile.age ? <span>Age {activeProfile.age}</span> : null}
              <IconSwitch size={13} />
            </button>
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />}
            </button>
            <button className="icon-btn" onClick={refresh} title="Refresh data" aria-label="Refresh data">
              <IconRefresh size={16} />
            </button>
            <button className="btn-secondary" onClick={chooseFolder}>
              <IconImport size={16} /> Import Data
            </button>
            <div
              className="report-action"
              onMouseEnter={() => setShowReportTip(true)}
              onMouseLeave={() => setShowReportTip(false)}
            >
              <button className="btn-primary" onClick={saveReport}>
                <IconFileText size={16} /> Save Report
              </button>
              {showReportTip && (
                <div className="report-tip">
                  Generates a printable PDF clinical summary — AHI, usage, leak, event profile, trend charts, and metric
                  correlations. Designed to bring to your care team appointment.
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="print-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img
              src={new URL("./assets/PLReportLogo.png", import.meta.url).href}
              alt="PAPLens Logo"
              style={{ height: "48px", width: "auto" }}
            />
            <div>
              <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Clinical Report</h1>
              <div style={{ color: "#555" }}>Processed securely offline</div>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
            <strong>Generated:</strong> {new Date().toLocaleDateString()}
            <br />
            <strong>Patient Name:</strong> {activeProfile.name} {activeProfile.age ? `(Age: ${activeProfile.age})` : ""}
            <br />
            <strong>Device:</strong> {deviceInfo.productName || "Unknown"} (SN: {deviceInfo.serialNumber || "Unknown"})
          </div>
        </div>

        <div className="clinical-layout">
          <aside className="left-sidebar">
            <div className="sidebar-section-label">Workspace</div>
            <nav className="sidebar-nav">
              <button
                className={activeTab === "overview" ? "active" : ""}
                onClick={() => setActiveTab("overview")}
                data-label="Overview"
                aria-label="Overview"
              >
                <IconDashboard size={20} />
                <span>Overview</span>
              </button>
              <button
                className={activeTab === "sessions" ? "active" : ""}
                onClick={() => setActiveTab("sessions")}
                data-label="Daily Sessions"
                aria-label="Daily Sessions"
              >
                <IconCalendar size={20} />
                <span>Daily Sessions</span>
              </button>
              <button
                className={activeTab === "insights" ? "active" : ""}
                onClick={() => setActiveTab("insights")}
                data-label="Insights"
                aria-label="Insights"
              >
                <IconChart size={20} />
                <span>Analytics</span>
              </button>
            </nav>
            <div className="sidebar-status" aria-label="Data status">
              <div className="sidebar-status-title">
                <span className="status-dot" aria-hidden="true" /> Local data
              </div>
              <p className="status-line">{status}</p>
              <p className="imported-line">{lastImportedLine}</p>
            </div>
          </aside>

          <section className="main-content">
            <ErrorBoundary>
              <div style={{ display: activeTab === "overview" ? "block" : "none" }}>
                <section style={{ margin: 0 }}>
                  {/* RANGE CONTROLS ROW */}
                  <div className="control-row" style={{ marginBottom: "20px" }}>
                    <div className="page-heading">
                      <div className="section-eyebrow">Clinical workspace</div>
                      <h2 style={{ margin: 0 }}>Therapy Overview</h2>
                    </div>
                    {renderRangeControls()}
                  </div>

                  {/* SECTION A: Device Info + Therapy Efficacy Overview */}
                  {filteredStats.length > 0 &&
                    (() => {
                      const last = analyzedStats[analyzedStats.length - 1];
                      const avgOf = (list, fn, positiveOnly = false) => {
                        const vals = list
                          .map(fn)
                          .filter((v) => v != null && !isNaN(v) && (positiveOnly ? v > 0 : v >= 0));
                        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                      };
                      const avgAhi = avgOf(analyzedStats, (d) => d.ahi);
                      const avgLeak = avgOf(analyzedStats, (d) => d.leak50, true);
                      const avgPressure = avgOf(analyzedStats, (d) => d.pressure, true);
                      const usageValues = usageTrackedStats
                        .map((d) => d.usageHours)
                        .filter((v) => v != null && !isNaN(v) && v >= 0);
                      const avgUsage = usageValues.length
                        ? usageValues.reduce((a, b) => a + b, 0) / usageValues.length
                        : null;

                      // Prior equal-length window for deltas (empty for all/custom)
                      const priorAvgAhi = avgOf(priorAnalyzedStats, (d) => d.ahi);
                      const priorAvgLeak = avgOf(priorAnalyzedStats, (d) => d.leak50, true);
                      const priorAvgPressure = avgOf(priorAnalyzedStats, (d) => d.pressure, true);
                      const priorAvgUsage = avgOf(priorUsageTrackedStats, (d) => d.usageHours);
                      const periodLabel = `prior ${range}d`;

                      // ── Consolidated hero: last-night column + score ring ──────────
                      // Score ring shows the most recent night's stability score
                      // (getLastNightOverview), falling back to the last in-range night.
                      const heroScore = (() => {
                        const s = toMetricNumber(lastNight?.therapy_stability_score);
                        if (s != null) return Math.round(s);
                        const f = toMetricNumber(last?.therapy_stability_score);
                        return f != null ? Math.round(f) : null;
                      })();
                      const heroColor =
                        heroScore == null
                          ? "var(--muted)"
                          : heroScore >= 95
                            ? "var(--success)"
                            : heroScore >= 85
                              ? "var(--cyan)"
                              : heroScore >= 70
                                ? "var(--warning)"
                                : heroScore >= 50
                                  ? "var(--tier-orange)"
                                  : "var(--critical)";
                      const heroTier =
                        heroScore == null
                          ? "No data"
                          : heroScore >= 95
                            ? "Optimal"
                            : heroScore >= 85
                              ? "Stable"
                              : heroScore >= 70
                                ? "Acceptable"
                                : heroScore >= 50
                                  ? "Suboptimal"
                                  : "High Risk";
                      const avgColLabel =
                        range === "custom" ? "Range avg" : range === "all" ? "All-time avg" : `${range}-day avg`;
                      // Last-night metric values (treat 0 as no-data for pressure)
                      const lnAhi = toMetricNumber(lastNight?.ahi_total);
                      const lnLeak = toMetricNumber(lastNight?.leak_p50);
                      const lnUsage = toMetricNumber(lastNight?.usage_hours);
                      const lnPressureRaw = toMetricNumber(lastNight?.pressure_median);
                      const lnPressure = lnPressureRaw != null && lnPressureRaw > 0 ? lnPressureRaw : null;
                      const heroRows = [
                        {
                          key: "ahi",
                          label: "AHI",
                          unit: "ev/hr",
                          dec: 1,
                          last: lnAhi,
                          avg: avgAhi,
                          prior: priorAvgAhi,
                          goodWhenDown: true,
                          info: "Apnea–Hypopnea Index: breathing interruptions per hour of sleep. Under 5 is considered controlled therapy."
                        },
                        {
                          key: "leak",
                          label: "Leak P50",
                          unit: "L/min",
                          dec: 1,
                          last: lnLeak,
                          avg: avgLeak,
                          prior: priorAvgLeak,
                          goodWhenDown: true,
                          info: "Median mask leak across the night, in liters per minute. Sustained high leak reduces therapy effectiveness."
                        },
                        {
                          key: "usage",
                          label: "Usage",
                          unit: "hrs",
                          dec: 1,
                          last: lnUsage,
                          avg: avgUsage,
                          prior: priorAvgUsage,
                          goodWhenDown: false,
                          info: "Therapy hours per night. 4 or more hours is the common compliance benchmark."
                        },
                        {
                          key: "pressure",
                          label: "Pressure",
                          unit: "cmH₂O",
                          dec: 1,
                          last: lnPressure,
                          avg: avgPressure,
                          prior: priorAvgPressure,
                          goodWhenDown: false,
                          delta: false,
                          info: "Median delivered pressure across the night, in cmH₂O."
                        }
                      ];

                      // Plain-language range summary
                      const nights = analyzedStats.length;
                      const controlled = analyzedStats.filter((d) => {
                        const v = toMetricNumber(d.ahi);
                        return v != null && v < AHI_MILD;
                      }).length;
                      const compliantNights = usageValues.filter((v) => v >= USAGE_COMPLIANCE_HOURS).length;
                      const leakDelta = avgLeak != null && priorAvgLeak != null ? avgLeak - priorAvgLeak : null;
                      let leakNote = null;
                      if (avgLeak != null && avgLeak >= LEAK_HIGH) {
                        leakNote = `Median leak averaged ${avgLeak.toFixed(1)} L/min, above the ${LEAK_HIGH} L/min limit — check the mask seal and cushion fit.`;
                      } else if (leakDelta != null && leakDelta > 2) {
                        leakNote = `Median leak averaged ${avgLeak.toFixed(1)} L/min, up ${leakDelta.toFixed(1)} from the prior period — worth checking the mask seal.`;
                      }
                      let tone = "good";
                      let toneLabel = "On track";
                      if (avgAhi != null && avgAhi > AHI_MODERATE) {
                        tone = "bad";
                        toneLabel = "High residual AHI";
                      } else if (
                        (nights > 0 && controlled / nights < 0.7) ||
                        leakNote ||
                        (avgUsage != null && avgUsage < USAGE_COMPLIANCE_HOURS)
                      ) {
                        tone = "warn";
                        toneLabel = "Needs attention";
                      }

                      return (
                        <>
                          {nights > 0 && (
                            <div className="summary-strip">
                              <div>
                                <p className="summary-headline">
                                  AHI was under {AHI_MILD} on {controlled} of {nights} analyzed nights
                                  {usageValues.length > 0 &&
                                    `; usage met the ${USAGE_COMPLIANCE_HOURS}-hour benchmark on ${compliantNights} of ${usageValues.length} nights`}
                                  .
                                </p>
                                {leakNote && <p className="summary-note">{leakNote}</p>}
                              </div>
                              <span className={`status-pill pill-${tone}`}>{toneLabel}</span>
                            </div>
                          )}
                          <div className="overview-hero-grid">
                            <div className="stability-overview">
                              <div className="hero-score">
                                <ScoreRing
                                  score={heroScore}
                                  size={128}
                                  strokeWidth={8}
                                  label="Score"
                                  stroke={heroScore == null ? undefined : heroColor}
                                />
                                <div className="hero-tier" style={{ color: heroColor }}>
                                  {heroTier}
                                </div>
                                <div className="hero-nights">
                                  <strong>{nights}</strong> of {filteredStats.length} nights analyzed
                                </div>
                              </div>
                              <div className="hero-metric-cards">
                                <section className="hero-metric-card" aria-label="Last night metrics">
                                  <div className="hero-metric-card-title">Last night</div>
                                  {heroRows.map((r) => (
                                    <div key={r.key} className="hero-metric-row">
                                      <div className="hero-metric-label">
                                        {r.label} <InfoTip text={r.info} />
                                      </div>
                                      <div className="hero-metric-value">
                                        <span className="hero-num">{r.last == null ? "—" : r.last.toFixed(r.dec)}</span>
                                        {r.last != null && <span className="hero-unit">{r.unit}</span>}
                                      </div>
                                    </div>
                                  ))}
                                </section>
                                <section className="hero-metric-card" aria-label={`${avgColLabel} metrics`}>
                                  <div className="hero-metric-card-title">{avgColLabel}</div>
                                  {heroRows.map((r) => (
                                    <div key={r.key} className="hero-metric-row">
                                      <div className="hero-metric-label">
                                        {r.label} <InfoTip text={r.info} />
                                      </div>
                                      <div className="hero-metric-value">
                                        <span className="hero-num">{r.avg == null ? "—" : r.avg.toFixed(r.dec)}</span>
                                        {r.avg != null && <span className="hero-unit">{r.unit}</span>}
                                        {r.delta !== false && (
                                          <MetricDelta
                                            current={r.avg}
                                            prior={r.prior}
                                            goodWhenDown={r.goodWhenDown}
                                            periodLabel={periodLabel}
                                          />
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </section>
                              </div>
                            </div>
                            <LastNightDetails data={lastNight} />
                          </div>
                        </>
                      );
                    })()}

                  <div className="clinical-charts-grid">
                    {supportsAHI && (
                      <TrendChart
                        reportKey="ahi"
                        title="AHI (Events/hr)"
                        labels={trendsData.labels}
                        datasets={overviewChartDatasets.ahi}
                      />
                    )}

                    {supportsLeakPercentiles && (
                      <TrendChart
                        reportKey="leak"
                        title="Leak (L/min) & Percentiles"
                        labels={trendsData.labels}
                        datasets={overviewChartDatasets.leak}
                      />
                    )}

                    <TrendChart
                      reportKey="pressure"
                      title="Pressure Therapy Dynamics"
                      labels={trendsData.labels}
                      datasets={overviewChartDatasets.pressure}
                    />

                    {supportsVentilation && (
                      <TrendChart
                        reportKey="flow"
                        title="Respiratory Flow Limitations"
                        labels={trendsData.labels}
                        datasets={overviewChartDatasets.flow}
                      />
                    )}

                    {supportsVentilation && (
                      <TrendChart
                        reportKey="tidal"
                        title="Tidal Volume Variances"
                        labels={trendsData.labels}
                        datasets={overviewChartDatasets.tidal}
                      />
                    )}

                    <TrendChart
                      reportKey="usage"
                      title="Compliance Usage Hours"
                      type="bar"
                      labels={trendsData.labels}
                      datasets={overviewChartDatasets.usage}
                    />

                    {supportsOximetry && hasOximetryTrend && (
                      <TrendChart
                        reportKey="oximetry"
                        title="Oximetry Validation"
                        labels={trendsData.labels}
                        datasets={overviewChartDatasets.oximetry}
                      />
                    )}
                  </div>
                  {/* SECTION B: Sleep Calendar — bottom of dashboard */}
                  {filteredStats.length > 0 && <SleepCalendar data={filteredStats} />}
                </section>
                <div style={FOOTER_CREDIT_STYLE}>
                  PAPLens by Gabriel Chavez&nbsp;&nbsp;|&nbsp;&nbsp;Developed in Mexico with love
                </div>
              </div>
            </ErrorBoundary>

            {activeTab === "sessions" && (
              <ErrorBoundary>
                <section className="panel" style={{ margin: 0 }}>
                  <div className="split-left">
                    <div className="control-row">
                      <div className="page-heading">
                        <div className="section-eyebrow">Night-by-night review</div>
                        <h2>Daily Details &amp; Sessions</h2>
                      </div>
                      <div className="controls">
                        <label>Sleep Boundary (Start Hr):</label>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          style={{ width: "60px" }}
                          value={dayStartHour}
                          onChange={(e) => setDayStartHour(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="America/Denver"
                          style={{ width: "150px" }}
                          value={sleepTimeZone}
                          onChange={(e) => setSleepTimeZone(e.target.value)}
                          aria-label="Sleep boundary timezone"
                        />
                        <button className="btn-secondary" onClick={applySleepFilter}>
                          Apply
                        </button>
                      </div>
                    </div>

                    <div className="list-container" style={{ paddingRight: "10px" }}>
                      {[...filteredStats]
                        .reverse()
                        .filter((day) => !isNoDataDay(day))
                        .map((day) => (
                          <ClinicalSummaryCard
                            key={day.date}
                            night={day}
                            isSelected={selectedDay?.date === day.date}
                            onSelect={selectDailySession}
                          />
                        ))}
                    </div>
                  </div>

                  <div style={FOOTER_CREDIT_STYLE}>
                    PAPLens by Gabriel Chavez&nbsp;&nbsp;|&nbsp;&nbsp;Developed in Mexico with love
                  </div>
                </section>
              </ErrorBoundary>
            )}

            {isSessionModalOpen && (
              <ErrorBoundary>
                <SessionGraphsModal
                  sessions={modalSessions}
                  theme={theme}
                  onClose={() => setIsSessionModalOpen(false)}
                />
              </ErrorBoundary>
            )}

            {activeTab === "insights" && (
              <ErrorBoundary>
                <section style={{ margin: 0, display: "flex", flexDirection: "column", gap: 20 }}>
                  {/* RANGE CONTROLS ROW */}
                  <div className="control-row" style={{ marginBottom: 0 }}>
                    <div className="page-heading">
                      <div className="section-eyebrow">Clinical statistics</div>
                      <h2 style={{ margin: 0 }}>Analytics &amp; Explanations</h2>
                    </div>
                    {renderRangeControls()}
                  </div>
                  <Suspense fallback={<SkeletonPanel rows={3} />}>
                    <Insights range={range} customFrom={customFrom} customTo={customTo} />
                  </Suspense>
                  <div style={FOOTER_CREDIT_STYLE}>
                    PAPLens by Gabriel Chavez&nbsp;&nbsp;|&nbsp;&nbsp;Developed in Mexico with love
                  </div>
                </section>
              </ErrorBoundary>
            )}
          </section>
        </div>

        {showAboutModal && (
          <div
            onClick={() => setShowAboutModal(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowAboutModal(false);
            }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2000,
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              background: "rgba(0,0,0,0.65)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="About PAPLens"
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 20,
                padding: "48px 56px",
                textAlign: "center",
                boxShadow: "0 32px 100px rgba(0,0,0,0.7)",
                maxWidth: 420,
                width: "90%"
              }}
            >
              <img
                src={
                  theme === "light"
                    ? new URL("./assets/PLLogoL.png", import.meta.url).href
                    : new URL("./assets/PLLogoD.png", import.meta.url).href
                }
                alt="PAPLens"
                style={{ height: 64, width: "auto", marginBottom: 20 }}
              />
              <h2 style={{ margin: "0 0 24px", fontSize: "1.5rem", fontWeight: 700, color: "var(--text)" }}>PAPLens</h2>
              <p style={{ margin: "0 0 28px", fontSize: "0.9rem", color: "var(--muted)", lineHeight: 1.7 }}>
                PAPLens processes your CPAP data entirely offline — no accounts, no cloud, no data leaving your device.
              </p>
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  paddingTop: 20,
                  fontSize: "0.8rem",
                  color: "var(--muted)"
                }}
              >
                PAPLens by Gabriel Chavez&nbsp;&nbsp;|&nbsp;&nbsp;Developed in Mexico with love
              </div>
              <button
                ref={aboutCloseButtonRef}
                onClick={() => setShowAboutModal(false)}
                style={{
                  marginTop: 24,
                  padding: "10px 28px",
                  background: "var(--brand)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </main>
    </ThemeContext.Provider>
  );
}
