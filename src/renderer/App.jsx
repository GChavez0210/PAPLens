import { useEffect, useMemo, useState } from "react";
import { TrendChart } from "./charts/TrendChart";
import { LastNightSidebar } from "./components/LastNightSidebar";
import { Insights } from "./pages/Insights";
import { ProfileSelector } from "./components/ProfileSelector";
import { ClinicalSummaryCard } from "./components/ClinicalSummaryCard";

const RANGE_OPTIONS = ["7", "14", "30", "60", "90", "180", "365", "all", "custom"];

function getScoreTier(score) {
  if (score === null || score === undefined) return 0;
  if (score >= 80) return 1;
  if (score >= 60) return 2;
  if (score >= 40) return 3;
  return 4;
}

function severity(metric, value) {
  if (metric === "ahi") {
    if (value < 5) return "normal";
    if (value <= 15) return "warning";
    return "critical";
  }
  if (metric === "usageHours") {
    if (value >= 4) return "normal";
    if (value >= 2) return "warning";
    return "critical";
  }
  if (metric === "leak50") {
    if (value < 24) return "normal";
    if (value <= 36) return "warning";
    return "critical";
  }
  if (metric === "spo2Avg") {
    if (value >= 95) return "normal";
    if (value >= 90) return "warning";
    return "critical";
  }
  return "normal";
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

export function App() {
  const [activeProfile, setActiveProfile] = useState(null);
  const [activeTab, setActiveTab] = useState("overview"); // overview or insights
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("Loading...");
  const [range, setRange] = useState("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dayStartHour, setDayStartHour] = useState(12);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [selectedDot, setSelectedDot] = useState(null);

  const loadCurrentProfile = async () => {
    const profile = await window.cpapAPI.getActiveProfile();
    setActiveProfile(profile);
    if (!profile) return;
    loadCurrent();
  };

  const loadCurrent = async () => {
    const current = await window.cpapAPI.getSummary();
    if (current) {
      setSummary(current);
      setStatus("Loaded");
      return;
    }
    const lastPath = await window.cpapAPI.getLastDataPath();
    if (lastPath) {
      const result = await window.cpapAPI.loadDataFolder(lastPath);
      if (result.success) {
        setSummary(result.summary);
        setStatus(`Loaded from ${lastPath}`);
        return;
      }
    }
    setStatus("Select a CPAP folder to begin");
  };

  useEffect(() => {
    loadCurrentProfile();
    const unsubscribe = window.cpapAPI.onDataLoaded((data) => {
      setSummary(data);
      setStatus("Loaded");
    });
    return () => unsubscribe();
  }, []);

  const deviceInfo = summary?.deviceInfo || {};
  const stats = summary?.dailyStats || [];

  const filteredStats = useMemo(() => {
    if (!stats.length) return [];
    if (range === "all") {
      return [...stats].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    if (range === "custom") {
      if (!customFrom || !customTo) return stats;
      const from = new Date(customFrom).getTime();
      const to = new Date(customTo).getTime();
      return [...stats]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .filter((d) => {
          const t = new Date(d.date).getTime();
          return t >= from && t <= to;
        });
    }
    const days = parseInt(range, 10);
    if (Number.isNaN(days)) return stats;
    return [...stats]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-days);
  }, [stats, range, customFrom, customTo]);

  const trendsData = useMemo(() => {
    const ahiArr = filteredStats.map((d) => d.ahi);
    // 7-day rolling average of AHI
    const rolling7 = ahiArr.map((_, i) => {
      const slice = ahiArr.slice(Math.max(0, i - 6), i + 1);
      return parseFloat((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
    });
    const n = filteredStats.length;
    return {
      labels: filteredStats.map((d) => d.date),
      ahi: ahiArr,
      ai: filteredStats.map((d) => d.ai),
      hi: filteredStats.map((d) => d.hi),
      cai: filteredStats.map((d) => d.cai),
      usage: filteredStats.map((d) => d.usageHours),
      leak50: filteredStats.map((d) => d.leak50),
      leak95: filteredStats.map((d) => d.leak95),
      pressure: filteredStats.map((d) => d.pressure),
      maxPressure: filteredStats.map((d) => d.maxPressure),
      pressureVarIndex: filteredStats.map((d) => parseFloat(((d.maxPressure || 0) - (d.pressure || 0)).toFixed(2))),
      minVent50: filteredStats.map((d) => d.minVent50),
      minVent95: filteredStats.map((d) => d.minVent95),
      tidVol50: filteredStats.map((d) => d.tidVol50),
      tidVol95: filteredStats.map((d) => d.tidVol95),
      respRate: filteredStats.map((d) => d.respRate50),
      spo2: filteredStats.map((d) => d.spo2Avg),
      pulse: filteredStats.map((d) => d.pulseAvg),
      // Derived
      rolling7Ahi: rolling7,
      ahiThreshold: Array(n).fill(5),
      leakThreshold: Array(n).fill(24),
    };
  }, [filteredStats]);

  const chooseFolder = async () => {
    setStatus("Selecting folder...");
    const result = await window.cpapAPI.selectDataFolder();
    if (result.success) {
      setSummary(result.summary);
      setStatus(`Loaded from ${result.path}`);
    } else {
      setStatus(result.error);
    }
  };

  const refresh = async () => {
    setStatus("Refreshing data...");
    const result = await window.cpapAPI.refresh();
    if (result.success) {
      setSummary(result.summary);
      setStatus("Refreshed");
    } else {
      setStatus(result.error);
    }
  };

  const saveReport = async () => {
    setStatus("Generating PDF report...");

    const canvases = document.querySelectorAll('.clinical-charts-grid canvas');
    const charts = {};
    if (canvases.length >= 6) {
      charts.ahiDataUri = canvases[0]?.toDataURL('image/png');
      charts.usageDataUri = canvases[5]?.toDataURL('image/png'); // Moved to end
      charts.pressureLeakDataUri = canvases[2]?.toDataURL('image/png'); // Pressure
      charts.flowDataUri = canvases[3]?.toDataURL('image/png'); // Flow limitation
      charts.tidalDataUri = canvases[4]?.toDataURL('image/png'); // Tidal Vol
      charts.ahiCaption = "Total AHI combined with event type breakdown.";
      charts.usageCaption = "Nightly therapy application time.";
      charts.pressureLeakCaption = "95th percentile and median delivered pressure.";
      charts.flowCaption = "Minute ventilation and respiration rate.";
      charts.tidalCaption = "Median and 95th percentile tidal volume.";
    }

    const reportData = {
      report: {
        generatedAt: new Date().toLocaleString(),
        rangeLabel: range === "all" ? "All Time" : range === "custom" ? `${customFrom} to ${customTo}` : `Last ${range} Days`,
        windowDays: range === "all" ? 90 : range === "custom" ? 30 : parseInt(range, 10),
        startDate: range === "custom" ? customFrom : null,
        endDate: range === "custom" ? customTo : null,
        sleepBoundaryLabel: `Noon-to-Noon (Start: ${dayStartHour}:00)`,
        footerRight: "Page 1 of 1"
      },
      profile: {
        name: activeProfile.name || "Unknown",
        age: activeProfile.age || "",
        notes: "Generated from PAPLens Desktop."
      },
      device: {
        model: deviceInfo.productName || "Unknown",
        manufacturer: "ResMed", // default assumption for now
        serialNumber: deviceInfo.serialNumber || "Unknown",
        firmware: deviceInfo.firmwareVersion || "Unknown"
      },
      charts
    };

    const result = await window.cpapAPI.saveReport(reportData);
    if (result.success) {
      setStatus(`Saved to ${result.filePath}`);
    } else {
      setStatus(result.error || "Save report failed");
    }
  };

  const applySleepFilter = async () => {
    const result = await window.cpapAPI.setTimeFilter(Number(dayStartHour), Number(dayStartHour));
    if (result.success) {
      setSummary(result.summary);
      setStatus(`Sleep boundary updated: ${dayStartHour}:00 to ${dayStartHour}:00`);
      return;
    }
    setStatus(result.error || "Sleep boundary update failed");
  };

  const openSession = async (session) => {
    setSelectedSession(session);
    const detail = await window.cpapAPI.getSessionDetail(session.id);
    setSessionDetail(detail);
  };

  if (!activeProfile) {
    return <ProfileSelector onSelect={() => loadCurrentProfile()} />;
  }

  return (
    <main className="app-shell">
      <header className="top-nav">
        <div className="brand">
          <img src={new URL("./assets/PAPLens-Logo.png", import.meta.url).href} alt="PAPLens" style={{ height: "36px", width: "auto" }} />
        </div>
        <div className="nav-controls" style={{ marginLeft: "auto" }}>
          {deviceInfo.productName && (() => {
            const name = (deviceInfo.productName || "").toLowerCase();
            const model = name.includes("11") ? "AirSense 11" : name.includes("10") ? "AirSense 10" : deviceInfo.productName;
            return (
              <span style={{ fontSize: '0.75rem', color: '#9ca3af', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.9rem' }}>🖥️</span> {model}
              </span>
            );
          })()}
          <button className="btn-primary" onClick={saveReport}>
            Save Data Report
          </button>
          <button className="btn-secondary" onClick={chooseFolder}>
            Open Data Folder
          </button>
          <button className="btn-secondary" onClick={refresh}>
            Refresh
          </button>
        </div>
      </header>

      <p className="status-line">{status}</p>

      <div className="print-header">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img src={new URL("./assets/PAPLens-ReportLogo.png", import.meta.url).href} alt="PAPLens Logo" style={{ height: "48px", width: "auto" }} />
          <div>
            <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Clinical Report</h1>
            <div style={{ color: "#555" }}>Processed securely offline</div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "0.9rem" }}>
          <strong>Generated:</strong> {new Date().toLocaleDateString()}<br />
          <strong>Patient Name:</strong> {activeProfile.name} {activeProfile.age ? `(Age: ${activeProfile.age})` : ""}<br />
          <strong>Device:</strong> {deviceInfo.productName || "Unknown"} (SN: {deviceInfo.serialNumber || "Unknown"})
        </div>
      </div>

      <div className="clinical-layout">
        <aside className="left-sidebar">
          <div className="info-edit" style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '15px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Active Profile</label>
            <strong style={{ fontSize: '1.2em', color: 'var(--brand)' }}>{activeProfile.name}</strong>
            {activeProfile.age && <span style={{ fontSize: "0.8em", color: "var(--muted)" }}>(Age: {activeProfile.age})</span>}
            <button
              className="btn-secondary"
              style={{ padding: "4px 8px", fontSize: "0.8em", marginTop: "5px" }}
              onClick={async () => {
                await window.cpapAPI.setActiveProfile(null);
                setActiveProfile(null);
              }}
            >
              Switch Profile
            </button>
          </div>

          <nav className="sidebar-nav">
            <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>Dashboard Overview</button>
            <button className={activeTab === "sessions" ? "active" : ""} onClick={() => setActiveTab("sessions")}>Clinical Daily Sessions</button>
            <button className={activeTab === "insights" ? "active" : ""} onClick={() => setActiveTab("insights")}>Analytics & Explanations</button>
          </nav>

          <LastNightSidebar />
        </aside>

        <section className="main-content">
          {activeTab === "overview" && (
            <>
              <section style={{ margin: 0 }}>
                {/* RANGE CONTROLS ROW */}
                <div className="control-row" style={{ marginBottom: "20px" }}>
                  <h2 style={{ margin: 0 }}>Clinical Dashboard</h2>
                  <div className="controls">
                    <label>View Range:</label>
                    <select value={range} onChange={(e) => setRange(e.target.value)}>
                      {RANGE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt === "all" ? "All Time" : opt === "custom" ? "Custom" : `Last ${opt} Days`}
                        </option>
                      ))}
                    </select>
                    {range === "custom" && (
                      <>
                        <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                        <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                      </>
                    )}
                  </div>
                </div>

                {/* SECTION A: Device Info + Therapy Efficacy Overview */}
                {filteredStats.length > 0 && (() => {
                  const last = filteredStats[filteredStats.length - 1];
                  const rangeAvg = (fn) => {
                    const vals = filteredStats.map(fn).filter(v => v != null && !isNaN(v) && v >= 0);
                    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                  };
                  const avgAhi = rangeAvg(d => d.ahi);
                  const avgLeak = rangeAvg(d => d.leak50);
                  const avgUsage = rangeAvg(d => d.usageHours);
                  const rangeLabel = range === 'all' ? 'All Time' : range === 'custom' ? 'Custom' : `Last ${range} Days`;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                      {/* Left: Device Info Card */}
                      <div style={{ background: 'linear-gradient(135deg, rgba(79,70,229,0.12) 0%, rgba(34,211,238,0.06) 100%)', border: '1px solid rgba(79,70,229,0.25)', borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 2, fontWeight: 700 }}>Device Information</div>
                        {[
                          { icon: '🖥️', label: 'Model', value: deviceInfo.productName || '—' },
                          { icon: '🔢', label: 'Serial', value: deviceInfo.serialNumber || '—' },
                          { icon: '⚙️', label: 'Firmware', value: deviceInfo.firmwareVersion || '—' },
                        ].map(({ icon, label, value }) => (
                          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: '1.4rem', width: 32, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
                            <div>
                              <div style={{ fontSize: '0.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'white' }}>{value}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="stability-overview" style={{ margin: 0 }}>
                        <div className={`score-circle tier-${last?.leak_severity_tier || 1}`}>
                          <div className="score-value">{Math.round(last?.therapy_stability_score || 0)}</div>
                          <div className="score-label">Score</div>
                        </div>
                        <div className="overview-metrics">
                          <div className="overview-metric">
                            <div className="value">{avgAhi.toFixed(1)}</div>
                            <div className="label">Avg AHI</div>
                          </div>
                          <div className="overview-metric">
                            <div className="value">{avgLeak.toFixed(1)} L/m</div>
                            <div className="label">Avg Leak P50</div>
                          </div>
                          <div className="overview-metric">
                            <div className="value">{avgUsage.toFixed(1)} hrs</div>
                            <div className="label">Avg Usage</div>
                          </div>
                          <div className="overview-metric">
                            <div className="value" style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{rangeLabel}</div>
                            <div className="label">Range</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="clinical-charts-grid">
                  <TrendChart
                    title="AHI (Events/hr)"
                    labels={trendsData.labels}
                    datasets={[
                      { label: "Total AHI", data: trendsData.ahi, borderColor: "#ef4444", fill: true, backgroundColor: "rgba(239,68,68,0.08)" },
                      { label: "Central (CAI)", data: trendsData.cai, borderColor: "#f59e0b" },
                      { label: "Obstructive (OAI/AI)", data: trendsData.ai, borderColor: "#3b82f6" },
                      { label: "Hypopnea (HI)", data: trendsData.hi, borderColor: "#8b5cf6" },
                      { label: "7-Day Avg", data: trendsData.rolling7Ahi, borderColor: "#22d3ee", borderWidth: 2, borderDash: [4, 4], pointRadius: 0 },
                      { label: "AHI = 5 Threshold", data: trendsData.ahiThreshold, borderColor: "rgba(239,68,68,0.6)", borderWidth: 1.5, borderDash: [8, 4], pointRadius: 0, fill: false },
                    ]}
                  />

                  <TrendChart
                    title="Leak (L/min) & Percentiles"
                    labels={trendsData.labels}
                    datasets={[
                      { label: "Maximum Leak (95th)", data: trendsData.leak95, borderColor: "#ef4444", borderDash: [5, 5] },
                      { label: "Median Leak", data: trendsData.leak50, borderColor: "#3b82f6", fill: true, backgroundColor: "rgba(59,130,246,0.15)" },
                      { label: "24 L/min Critical Limit", data: trendsData.leakThreshold, borderColor: "rgba(239,68,68,0.7)", borderWidth: 1.5, borderDash: [8, 4], pointRadius: 0, fill: false },
                    ]}
                  />

                  <TrendChart
                    title="Pressure Therapy Dynamics"
                    labels={trendsData.labels}
                    datasets={[
                      { label: "95th Percentile", data: trendsData.maxPressure, borderColor: "#f59e0b" },
                      { label: "Median Delivery", data: trendsData.pressure, borderColor: "#10b981", fill: true, backgroundColor: "rgba(16,185,129,0.1)" },
                      { label: "Variability Index (P95−P50)", data: trendsData.pressureVarIndex, borderColor: "#8b5cf6", borderDash: [3, 3], pointRadius: 0 },
                    ]}
                  />

                  <TrendChart
                    title="Respiratory Flow Limitations"
                    labels={trendsData.labels}
                    datasets={[
                      { label: "Min Vent 95%", data: trendsData.minVent95, borderColor: "#8b5cf6", tension: 0.3 },
                      { label: "Min Vent 50%", data: trendsData.minVent50, borderColor: "#3b82f6", tension: 0.3 },
                      { label: "Resp Rate", data: trendsData.respRate, borderColor: "#f59e0b", yAxisID: "y1" }
                    ]}
                  />

                  <TrendChart
                    title="Tidal Volume Variances"
                    labels={trendsData.labels}
                    datasets={[
                      { label: "Upper Bound (95%)", data: trendsData.tidVol95, borderColor: "#f59e0b", borderDash: [5, 5] },
                      { label: "Median Efficacy", data: trendsData.tidVol50, borderColor: "#8b5cf6", fill: true, backgroundColor: "rgba(139, 92, 246, 0.1)" }
                    ]}
                  />

                  <TrendChart
                    title="Compliance Usage Hours"
                    labels={trendsData.labels}
                    datasets={[
                      {
                        label: "Duration",
                        data: trendsData.usage,
                        borderColor: "#10b981",
                        fill: true,
                        backgroundColor: "rgba(16, 185, 129, 0.15)"
                      }
                    ]}
                  />

                  {trendsData.spo2.some((v) => v > 0) && (
                    <TrendChart
                      title="Oximetry Validation"
                      labels={trendsData.labels}
                      datasets={[
                        { label: "SpO2 %", data: trendsData.spo2, borderColor: "#3b82f6" },
                        { label: "Pulse", data: trendsData.pulse, borderColor: "#ef4444", yAxisID: "y1" }
                      ]}
                    />
                  )}
                </div>

                {/* SECTION B: Treatment Efficacy Viewer — bottom of dashboard */}
                {filteredStats.length > 0 && (() => {
                  const tierColors = { 0: '#4b5563', 1: '#10b981', 2: '#f59e0b', 3: '#f97316', 4: '#ef4444' };
                  const tierLabels = { 0: '—', 1: 'Excellent', 2: 'Watch', 3: 'Attention', 4: 'Critical' };
                  return (
                    <div style={{ position: 'relative', marginTop: 20, background: 'linear-gradient(135deg, rgba(79,70,229,0.08) 0%, rgba(34,211,238,0.05) 100%)', border: '1px solid rgba(79,70,229,0.2)', borderRadius: 12, padding: '16px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <div>
                          <h4 style={{ margin: '0 0 2px 0', fontSize: '0.85rem', fontWeight: 700, color: 'white', letterSpacing: 1 }}>Treatment Efficacy Viewer</h4>
                          <div style={{ fontSize: '0.65rem', color: '#6b7280' }}>Click any dot to see night details</div>
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: '0.65rem', color: '#6b7280', alignItems: 'center' }}>
                          {[['#10b981', 'Excellent'], ['#f59e0b', 'Watch'], ['#f97316', 'Attention'], ['#ef4444', 'Critical']].map(([c, l]) => (
                            <span key={l}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c, marginRight: 4 }} />{l}</span>
                          ))}
                        </div>
                      </div>
                      <div className="timeline-strip">
                        {filteredStats.map((night) => (
                          <div
                            key={night.date}
                            className={`timeline-dot dot-t${getScoreTier(night.therapy_stability_score)}`}
                            style={{ outline: selectedDot?.date === night.date ? '2px solid white' : 'none', outlineOffset: 2 }}
                            onClick={(e) => { e.stopPropagation(); setSelectedDot(selectedDot?.date === night.date ? null : night); }}
                            title={night.date}
                          />
                        ))}
                      </div>
                      {selectedDot && (
                        <div onClick={() => setSelectedDot(null)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, cursor: 'default' }}>
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#1F2937', border: `1px solid ${tierColors[getScoreTier(selectedDot.therapy_stability_score)]}`, borderRadius: 12, padding: '18px 22px', minWidth: 280, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', cursor: 'default' }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                              <div>
                                <div style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>Night of</div>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'white' }}>{selectedDot.date}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '2rem', fontWeight: 900, color: tierColors[getScoreTier(selectedDot.therapy_stability_score)], lineHeight: 1 }}>{Math.round(selectedDot.therapy_stability_score || 0)}</div>
                                <div style={{ fontSize: '0.65rem', color: '#6b7280' }}>Treatment Score — {tierLabels[getScoreTier(selectedDot.therapy_stability_score)]}</div>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                              {[
                                ['AHI', `${Number(selectedDot.ahi || 0).toFixed(1)} ev/hr`],
                                ['Usage', `${Number(selectedDot.usageHours || 0).toFixed(1)} hrs`],
                                ['Leak (P50)', `${Number(selectedDot.leak50 || 0).toFixed(1)} L/min`],
                                ['Pressure', `${Number(selectedDot.pressure || 0).toFixed(1)} cmH₂O`],
                              ].map(([k, v]) => (
                                <div key={k}>
                                  <div style={{ fontSize: '0.65rem', color: '#6b7280', textTransform: 'uppercase' }}>{k}</div>
                                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'white' }}>{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ marginTop: 12, fontSize: '0.7rem', color: '#4b5563', textAlign: 'center' }}>Click outside to close</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

              </section>
            </>
          )}

          {activeTab === "sessions" && (
            <section className="panel flex-split" style={{ margin: 0 }}>
              <div className="split-left">
                <div className="control-row">
                  <h2>Daily Details & Sessions</h2>
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
                    <button className="btn-secondary" onClick={applySleepFilter}>
                      Apply
                    </button>
                  </div>
                </div>

                <div className="list-container" style={{ paddingRight: "10px" }}>
                  {[...filteredStats].reverse().map((day) => (
                    <ClinicalSummaryCard
                      key={day.date}
                      night={day}
                      isSelected={selectedDay?.date === day.date}
                      onSelect={setSelectedDay}
                    />
                  ))}
                </div>
              </div>

              <div className="split-right">
                {selectedDay ? (
                  <div>
                    <h3>{selectedDay.date} Breakdown</h3>
                    <div className="info-grid">
                      <div className="info-item">
                        <label>Total Usage</label>
                        <strong>{Number(selectedDay.usageHours).toFixed(2)} hrs</strong>
                      </div>
                      <div className="info-item">
                        <label>AHI</label>
                        <strong className={`badge badge-${severity("ahi", selectedDay.ahi)}`}>
                          {Number(selectedDay.ahi).toFixed(1)}
                        </strong>
                      </div>
                      <div className="info-item">
                        <label>Median Pressure</label>
                        <strong>{Number(selectedDay.pressure).toFixed(1)} cmH2O</strong>
                      </div>
                      <div className="info-item">
                        <label>Median Leak</label>
                        <strong className={`badge badge-${severity("leak50", selectedDay.leak50)}`}>
                          {Math.round(selectedDay.leak50)} L/min
                        </strong>
                      </div>
                    </div>

                    <h4 style={{ marginTop: "20px" }}>Recorded Sessions</h4>
                    <div className="list-container" style={{ maxHeight: "300px" }}>
                      {summary?.sessions &&
                        summary.sessions
                          .filter((s) => dayKeyFromSession(s) === selectedDay.date)
                          .map((session) => (
                            <div
                              key={session.id}
                              className={`list-item ${selectedSession?.id === session.id ? "active" : ""}`}
                              onClick={() => openSession(session)}
                            >
                              <div>
                                <strong>
                                  {new Date(session.timestamp).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit"
                                  })}
                                </strong>
                                <div style={{ fontSize: "0.85em", color: "var(--muted)" }}>
                                  Duration: {Math.round(session.durationMinutes)}m / Files:{" "}
                                  {Object.keys(session.files).length}
                                </div>
                              </div>
                            </div>
                          ))}
                    </div>

                    {sessionDetail && sessionDetail.id === selectedSession?.id && (
                      <div
                        style={{
                          marginTop: "20px",
                          padding: "15px",
                          background: "rgba(0,0,0,0.2)",
                          borderRadius: "8px"
                        }}
                      >
                        <h4 style={{ marginBottom: "10px" }}>Session Raw EDF Maps</h4>
                        {sessionDetail.files.map((data) => {
                          const [fileType] = data.file.split(".");
                          return (
                            <div key={data.file} style={{ marginBottom: "8px" }}>
                              <strong>{fileType}:</strong>{" "}
                              {data.error ? (
                                <span style={{ color: "var(--danger)" }}>{data.error}</span>
                              ) : (
                                <span style={{ fontSize: "0.85em", color: "var(--muted)" }}>
                                  {data.signals?.join(", ")}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted)"
                    }}
                  >
                    Select a date to view details
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === "insights" && (
            <section style={{ margin: 0, display: "flex", flexDirection: "column", gap: 20 }}>
              {/* RANGE CONTROLS ROW */}
              <div className="control-row" style={{ marginBottom: 0 }}>
                <h2 style={{ margin: 0 }}>Analytics & Explanations</h2>
                <div className="controls">
                  <label>View Range:</label>
                  <select value={range} onChange={(e) => setRange(e.target.value)}>
                    {RANGE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === "all" ? "All Time" : opt === "custom" ? "Custom" : `Last ${opt} Days`}
                      </option>
                    ))}
                  </select>
                  {range === "custom" && (
                    <>
                      <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                      <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                    </>
                  )}
                </div>
              </div>
              <Insights range={range} customFrom={customFrom} customTo={customTo} />
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
