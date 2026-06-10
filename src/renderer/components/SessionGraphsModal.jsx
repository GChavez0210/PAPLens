import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";

const MAX_POINTS = 1800;

function getFile(detail, fileType) {
  return detail?.data?.[fileType] && !detail.data[fileType].error ? detail.data[fileType] : null;
}

function pickSeries(file, labels) {
  if (!file?.rawData) {
    return null;
  }
  for (const label of labels) {
    if (Array.isArray(file.rawData[label]) && file.rawData[label].length > 0) {
      const signal = file.signals?.find((item) => item === label);
      return { label, values: file.rawData[label], signal };
    }
  }
  const lowered = labels.map((label) => label.toLowerCase());
  const found = Object.keys(file.rawData).find((label) =>
    lowered.some((needle) => label.toLowerCase().includes(needle.replace(".2s", "").replace(".40ms", "")))
  );
  return found ? { label: found, values: file.rawData[found], signal: null } : null;
}

function getDurationSeconds(file, fallbackCount = 0) {
  const records = Number(file?.header?.numDataRecords);
  const recordDuration = Number(file?.header?.dataRecordDuration);
  if (Number.isFinite(records) && Number.isFinite(recordDuration) && records > 0 && recordDuration > 0) {
    return records * recordDuration;
  }
  return fallbackCount * 2;
}

function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m`;
}

function buildPoints(values, file, maxPoints = MAX_POINTS) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  const duration = getDurationSeconds(file, values.length);
  const step = Math.max(1, Math.ceil(values.length / maxPoints));
  const points = [];
  for (let index = 0; index < values.length; index += step) {
    const value = Number(values[index]);
    if (Number.isFinite(value)) {
      points.push({
        x: values.length <= 1 ? 0 : (index / (values.length - 1)) * (duration / 60),
        y: value
      });
    }
  }
  return points;
}

// ── Breathing amplitude & PB-episode detection ────────────────────────────────

const ENVELOPE_WIN_SEC = 5; // seconds per amplitude window

/** Centred moving average — pure JS, no typed arrays needed. */
function cma(arr, halfWin) {
  return arr.map((_, i) => {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(arr.length - 1, i + halfWin);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += arr[j];
    return sum / (hi - lo + 1);
  });
}

/**
 * Compute peak-to-peak breathing amplitude in ENVELOPE_WIN_SEC-wide windows.
 * Works on the raw BRP flow array (any sample rate — inferred from EDF header).
 * Returns Chart-ready {x,y} points downsampled to ≤ maxPoints, or null if no data.
 */
function buildAmplitudePoints(values, file, maxPoints = 1500) {
  if (!Array.isArray(values) || values.length < 50) return null;
  const duration = getDurationSeconds(file, values.length);
  if (!(duration > 0)) return null;

  const secPerSample = duration / values.length;
  const winSamples = Math.max(10, Math.round(ENVELOPE_WIN_SEC / secPerSample));

  const rawAmp = [];
  const rawX = [];

  for (let i = 0; i < values.length; i += winSamples) {
    const end = Math.min(i + winSamples, values.length);
    let maxV = -Infinity;
    let minV = Infinity;
    for (let j = i; j < end; j++) {
      const v = Number(values[j]);
      if (!Number.isFinite(v)) continue;
      if (v > maxV) maxV = v;
      if (v < minV) minV = v;
    }
    if (!Number.isFinite(maxV)) continue;
    rawAmp.push(maxV - minV);
    rawX.push(((i + end) / 2 / (values.length - 1)) * (duration / 60));
  }

  if (rawAmp.length < 20) return null;

  // 15-second smoothing (half-win in envelope-point units)
  const smoothHalf = Math.max(1, Math.round(7.5 / ENVELOPE_WIN_SEC));
  const smoothed = cma(rawAmp, smoothHalf);

  const step = Math.max(1, Math.ceil(smoothed.length / maxPoints));
  const points = [];
  for (let i = 0; i < smoothed.length; i += step) {
    const v = smoothed[i];
    if (Number.isFinite(v)) points.push({ x: rawX[i], y: Math.max(0, v) });
  }
  return points.length >= 10 ? points : null;
}

/**
 * Detect PB episodes from the pre-smoothed amplitude series.
 * Uses a 90-second sliding window to find regions where amplitude
 * oscillates by ≥ 45% of the window mean.
 * Returns [{startMin, endMin}] — empty array if none detected.
 */
function detectPBFromAmplitude(ampPoints) {
  if (!ampPoints || ampPoints.length < 20) return [];
  const values = ampPoints.map((p) => p.y);
  const N = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / N;
  if (mean < 0.3) return []; // signal too weak

  const totalMin = ampPoints[N - 1].x - ampPoints[0].x;
  const minPerPoint = totalMin / Math.max(1, N - 1);

  // Half-window covering 45 s on each side
  const detectHalf = Math.max(3, Math.round(0.75 / minPerPoint));
  const pbFlags = new Array(N).fill(false);

  for (let i = detectHalf; i < N - detectHalf; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    const count = 2 * detectHalf + 1;
    for (let j = i - detectHalf; j <= i + detectHalf; j++) {
      if (values[j] < lo) lo = values[j];
      if (values[j] > hi) hi = values[j];
      sum += values[j];
    }
    const winMean = sum / count;
    if (winMean > 0.1 && (hi - lo) / winMean >= 0.45) pbFlags[i] = true;
  }

  const gapTol = Math.max(1, Math.round(0.25 / minPerPoint)); // 15 s gap
  const minEpLen = Math.max(3, Math.round(1.5 / minPerPoint)); // 90 s minimum
  const episodes = [];
  let epStart = -1;
  let gapRun = 0;

  for (let i = 0; i < N; i++) {
    if (pbFlags[i]) {
      if (epStart === -1) epStart = i;
      gapRun = 0;
    } else if (epStart !== -1) {
      if (++gapRun > gapTol) {
        const epEnd = i - gapRun;
        if (epEnd - epStart >= minEpLen) {
          episodes.push({ startMin: ampPoints[epStart].x, endMin: ampPoints[epEnd].x });
        }
        epStart = -1;
        gapRun = 0;
      }
    }
  }
  if (epStart !== -1) {
    const epEnd = Math.max(epStart, N - 1 - gapRun);
    if (epEnd - epStart >= minEpLen) {
      episodes.push({ startMin: ampPoints[epStart].x, endMin: ampPoints[epEnd].x });
    }
  }
  return episodes;
}

/**
 * Inline Chart.js plugin — draws amber rectangles for each PB episode
 * behind the datasets (beforeDatasetsDraw hook).
 */
function makePBRegionPlugin(episodes) {
  return {
    id: "pbRegions",
    beforeDatasetsDraw(chart) {
      if (!episodes || episodes.length === 0) return;
      const { ctx, chartArea, scales } = chart;
      if (!scales.x || !chartArea) return;
      ctx.save();
      ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
      for (const ep of episodes) {
        const x1 = Math.max(scales.x.getPixelForValue(ep.startMin), chartArea.left);
        const x2 = Math.min(scales.x.getPixelForValue(ep.endMin), chartArea.right);
        if (x2 > x1) ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.height);
      }
      // Draw a subtle amber top-border for each episode region
      ctx.strokeStyle = "rgba(245, 158, 11, 0.55)";
      ctx.lineWidth = 1.5;
      for (const ep of episodes) {
        const x1 = Math.max(scales.x.getPixelForValue(ep.startMin), chartArea.left);
        const x2 = Math.min(scales.x.getPixelForValue(ep.endMin), chartArea.right);
        if (x2 > x1) {
          ctx.beginPath();
          ctx.moveTo(x1, chartArea.top);
          ctx.lineTo(x2, chartArea.top);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  };
}

// ── End PB helpers ─────────────────────────────────────────────────────────────

function collectEvents(detail) {
  const eve = getFile(detail, "EVE");
  const annotations = eve?.rawData?.["EDF Annotations"] || [];
  return annotations
    .filter((event) => event && Number.isFinite(Number(event.onsetSeconds)) && event.text)
    .map((event) => ({
      ...event,
      onsetSeconds: Number(event.onsetSeconds),
      durationSeconds: Number.isFinite(Number(event.durationSeconds)) ? Number(event.durationSeconds) : null,
      text: String(event.text)
    }));
}

function eventColor(text) {
  const value = text.toLowerCase();
  if (value.includes("obstructive") || value === "oa") return "#ef4444";
  if (value.includes("central") || value === "ca") return "#8b5cf6";
  if (value.includes("hypopnea") || value === "h") return "#f59e0b";
  if (value.includes("rera")) return "#22d3ee";
  if (value.includes("leak")) return "#10b981";
  return "#64748b";
}

/** Nearest-neighbour lookup: returns pressure Y at xMin, or null. */
function interpolatePressureAt(pressurePoints, xMin) {
  if (!pressurePoints || pressurePoints.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const pt of pressurePoints) {
    const d = Math.abs(pt.x - xMin);
    if (d < bestDist) { bestDist = d; best = pt.y; }
  }
  return best;
}

/**
 * Builds one scatter dataset per unique event type so each type gets its own
 * legend entry and colour on the pressure chart.
 */
function buildEventOverlayDatasets(events, pressurePoints) {
  if (!events || events.length === 0) return [];

  // Group events by canonical type label
  const groups = new Map();
  for (const ev of events) {
    const color = eventColor(ev.text);
    if (!groups.has(ev.text)) groups.set(ev.text, { color, points: [] });
    const xMin = ev.onsetSeconds / 60;
    const y = interpolatePressureAt(pressurePoints, xMin);
    if (y !== null) {
      groups.get(ev.text).points.push({ x: xMin, y, durationSeconds: ev.durationSeconds, label: ev.text });
    }
  }

  return [...groups.entries()].map(([label, { color, points }]) => ({
    type: "scatter",
    label,
    data: points,
    backgroundColor: color,
    borderColor: "#fff",
    borderWidth: 1.5,
    pointRadius: 6,
    pointHoverRadius: 8,
    pointStyle: "circle",
    order: 0  // draw on top of line datasets
  }));
}

function SessionChart({ title, unit, datasets, yMin, yMax, theme, yTickLabel, tooltipLabel, externalPlugins }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const textColor = theme === "light" ? "#4b5563" : "#a1a1aa";
    const gridColor = theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.11)";
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { datasets },
      plugins: externalPlugins || [],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        normalized: true,
        interaction: { mode: "nearest", intersect: false },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Elapsed time", color: textColor },
            ticks: { color: textColor, callback: (value) => formatElapsed(Number(value) * 60), maxTicksLimit: 8 },
            grid: { color: gridColor }
          },
          y: {
            min: yMin,
            max: yMax,
            title: { display: Boolean(unit), text: unit, color: textColor },
            ticks: {
              color: textColor,
              callback: (value) => (yTickLabel ? yTickLabel(value) : value)
            },
            grid: { color: gridColor }
          }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: textColor, boxWidth: 14, boxHeight: 2 }
          },
          tooltip: {
            callbacks: {
              title: (items) => (items[0] ? formatElapsed(items[0].parsed.x * 60) : ""),
              label: (item) => tooltipLabel ? tooltipLabel(item) : `${item.dataset.label}: ${Number(item.parsed.y).toFixed(2)}${unit ? ` ${unit}` : ""}`
            }
          }
        }
      }
    });

    return () => chartRef.current?.destroy();
  }, [datasets, externalPlugins, theme, title, tooltipLabel, unit, yMax, yMin, yTickLabel]);

  return (
    <section className="session-graph-card">
      <h3>{title}</h3>
      <div className="session-graph-canvas">
        <canvas ref={canvasRef} />
      </div>
    </section>
  );
}

function EmptyGraph({ title, message }) {
  return (
    <section className="session-graph-card session-graph-empty">
      <h3>{title}</h3>
      <p>{message}</p>
    </section>
  );
}

/**
 * SessionGraphsModal
 *
 * Props:
 *   sessions  — array of session objects for the selected day; the modal owns
 *               its own detail-loading state and shows a picker when there are
 *               multiple sessions.
 *   theme     — "light" | "dark"
 *   onClose   — callback
 */
export function SessionGraphsModal({ sessions = [], theme, onClose }) {
  // Pick the first session that has BRP or PLD files as the default; fall back to index 0.
  const initialIdx = useMemo(() => {
    const i = sessions.findIndex((s) => s.files?.BRP || s.files?.PLD);
    return i >= 0 ? i : 0;
  }, [sessions]);

  const [activeIdx, setActiveIdx] = useState(initialIdx);
  const [detail, setDetail] = useState(null);
  const [reattaching, setReattaching] = useState(false);

  const loadSession = async (session, onResult) => {
    try {
      let d;
      if (session.id) {
        d = await window.cpapAPI.getSessionDetail(session.id);
      } else if (session.timestamp) {
        const dateStr = String(session.timestamp).split("T")[0];
        d = await window.cpapAPI.getBestSessionForDate(dateStr);
      } else {
        d = { error: "No session identifier available." };
      }
      onResult(d);
    } catch (err) {
      onResult({ error: err?.message || "Failed to load session." });
    }
  };

  // Reload EDF data whenever the selected session changes.
  useEffect(() => {
    const session = sessions[activeIdx];
    if (!session) return undefined;
    setDetail(null);
    let cancelled = false;
    loadSession(session, (d) => { if (!cancelled) setDetail(d); });
    return () => { cancelled = true; };
  }, [activeIdx, sessions]);

  const handleReattach = async () => {
    setReattaching(true);
    try {
      const result = await window.cpapAPI.reattachSessionFolder();
      if (!result?.success) {
        setReattaching(false);
        return;
      }
      // Retry loading the current session now that the folder is attached.
      setDetail(null);
      const session = sessions[activeIdx];
      if (session) loadSession(session, setDetail);
    } catch (err) {
      setDetail({ error: err?.message || "Failed to locate folder." });
    } finally {
      setReattaching(false);
    }
  };

  const activeSession = sessions[activeIdx] || null;

  const graphData = useMemo(() => {
    const brp = getFile(detail, "BRP");
    const pld = getFile(detail, "PLD");
    const pressure = [
      pickSeries(pld, ["MaskPress.2s", "Press.2s"]),
      pickSeries(pld, ["EprPress.2s"])
    ].filter(Boolean);
    const flow = pickSeries(brp, ["Flow.40ms", "Flow"]);
    const leak = pickSeries(pld, ["Leak.2s", "Leak"]);
    const flowLimitation = pickSeries(pld, ["FlowLim.2s", "FlowLimit.2s", "Flow Limitation"]);

    // Breathing amplitude — computed once, stored as a plain property
    const ampPoints = flow ? buildAmplitudePoints(flow.values, brp) : null;
    const pbEpisodes = ampPoints ? detectPBFromAmplitude(ampPoints) : [];
    const pbPlugin = pbEpisodes.length > 0 ? makePBRegionPlugin(pbEpisodes) : null;

    const pressureLinePoints = pressure.map((series) => buildPoints(series.values, pld));
    const events = collectEvents(detail);
    const eventOverlay = buildEventOverlayDatasets(events, pressureLinePoints[0] || []);

    return {
      pressure: [
        ...pressure.map((series, index) => ({
          type: "line",
          label: index === 0 ? "Mask pressure" : "EPAP/EPR pressure",
          data: pressureLinePoints[index],
          borderColor: index === 0 ? "#ef4444" : "#10b981",
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.7,
          tension: 0.15,
          order: 1
        })),
        ...eventOverlay
      ],
      flow: flow
        ? [{
            label: "Flow rate",
            data: buildPoints(flow.values, brp, 2200),
            borderColor: theme === "light" ? "#111827" : "#e5e7eb",
            backgroundColor: theme === "light" ? "rgba(17,24,39,0.08)" : "rgba(229,231,235,0.08)",
            pointRadius: 0,
            borderWidth: 1,
            tension: 0,
            fill: true
          }]
        : [],
      // Breathing amplitude: peak-to-peak envelope in 5-second windows (from BRP)
      amplitude: ampPoints
        ? [{
            label: "Tidal amplitude",
            data: ampPoints,
            borderColor: "#ef4444",
            backgroundColor: "rgba(239,68,68,0.08)",
            pointRadius: 0,
            borderWidth: 1.5,
            tension: 0.3,
            fill: true
          }]
        : [],
      pbEpisodes,
      pbPlugin,
      flowLimitation: flowLimitation
        ? [{
            label: "Flow limitation",
            data: buildPoints(flowLimitation.values, pld),
            borderColor: "#71717a",
            backgroundColor: "rgba(113,113,122,0.12)",
            pointRadius: 0,
            borderWidth: 1.5,
            fill: true,
            tension: 0.1
          }]
        : [],
      leak: leak
        ? [
            {
              label: "Leak rate",
              data: buildPoints(leak.values, pld),
              borderColor: "#16a34a",
              backgroundColor: "rgba(22,163,74,0.12)",
              pointRadius: 0,
              borderWidth: 1.5,
              fill: true,
              tension: 0.1
            },
            {
              label: "24 L/min threshold",
              data: (() => { const dur = getDurationSeconds(pld, leak.values.length) / 60; return [{ x: 0, y: 24 }, { x: dur, y: 24 }]; })(),
              borderColor: "#ef4444",
              pointRadius: 0,
              borderWidth: 1,
              borderDash: [5, 4],
              fill: false
            }
          ]
        : [],
      events
    };
  }, [detail, theme]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Derive a title from the active session timestamp.
  const start = activeSession?.timestamp ? new Date(activeSession.timestamp) : null;
  const sessionTitle = start && !Number.isNaN(start.getTime())
    ? start.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : activeSession?.id || "Session";

  return (
    <div className="session-modal-backdrop" onClick={onClose}>
      <div className="session-modal" role="dialog" aria-modal="true" aria-labelledby="session-modal-title" onClick={(event) => event.stopPropagation()}>
        <header className="session-modal-header">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p>Daily session graphs</p>
            <h2 id="session-modal-title">{sessionTitle}</h2>
          </div>

          {/* Session picker — only shown when multiple sessions exist for the day */}
          {sessions.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, marginRight: 12 }}>
              <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: 1, color: "var(--muted)", fontWeight: 600 }}>
                Session
              </span>
              <select
                value={activeIdx}
                onChange={(e) => setActiveIdx(Number(e.target.value))}
                style={{
                  background: "var(--card)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  minWidth: 130
                }}
                aria-label="Select session"
              >
                {sessions.map((s, i) => {
                  const t = s.timestamp
                    ? new Date(s.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : `Session ${i + 1}`;
                  const dur = s.durationMinutes ? ` · ${Math.round(s.durationMinutes)}m` : "";
                  return (
                    <option key={s.id || i} value={i}>
                      {t}{dur}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <button className="session-modal-close" type="button" onClick={onClose} aria-label="Close session graphs">
            ✕
          </button>
        </header>

        {!detail ? (
          <EmptyGraph title="Loading session graphs" message="Parsing the selected session EDF files..." />
        ) : detail?.error ? (
          <section className="session-graph-card session-graph-empty">
            <h3>Session unavailable</h3>
            <p>{detail.error}</p>
            {detail.error.toLowerCase().includes("original folder") && (
              <button
                type="button"
                onClick={handleReattach}
                disabled={reattaching}
                style={{
                  marginTop: 12, padding: "8px 18px", borderRadius: 6, cursor: reattaching ? "wait" : "pointer",
                  background: "var(--accent, #22D3EE)", color: "#000", border: "none",
                  fontWeight: 700, fontSize: "0.85rem", opacity: reattaching ? 0.6 : 1
                }}
              >
                {reattaching ? "Locating…" : "Locate data folder"}
              </button>
            )}
          </section>
        ) : (
          <div className="session-graphs-grid">
            {graphData.pressure.length > 0 ? (
              <SessionChart
                title="Pressure"
                unit="cmH2O"
                datasets={graphData.pressure}
                theme={theme}
                tooltipLabel={(item) => {
                  if (item.dataset.type === "scatter") {
                    const pt = item.raw || {};
                    const dur = pt.durationSeconds ? ` · ${Math.round(pt.durationSeconds)}s` : "";
                    return `${pt.label || item.dataset.label}${dur}`;
                  }
                  return `${item.dataset.label}: ${Number(item.parsed.y).toFixed(1)} cmH2O`;
                }}
              />
            ) : (
              <EmptyGraph title="Pressure" message="No pressure signal found for this session." />
            )}
            {graphData.flow.length > 0 ? (
              <SessionChart title="Flow Rate" unit="L/min" datasets={graphData.flow} theme={theme} />
            ) : (
              <EmptyGraph title="Flow Rate" message="No high-resolution flow signal found for this session." />
            )}
            {graphData.amplitude.length > 0 ? (
              <SessionChart
                title={
                  graphData.pbEpisodes.length > 0
                    ? `Breathing Amplitude — ${graphData.pbEpisodes.length} PB episode${graphData.pbEpisodes.length !== 1 ? "s" : ""} detected`
                    : "Breathing Amplitude"
                }
                unit="L/min"
                datasets={graphData.amplitude}
                yMin={0}
                theme={theme}
                externalPlugins={graphData.pbPlugin ? [graphData.pbPlugin] : []}
              />
            ) : null}
            {graphData.flowLimitation.length > 0 ? (
              <SessionChart title="Flow Limitation" unit="index" datasets={graphData.flowLimitation} yMin={0} yMax={1} theme={theme} />
            ) : (
              <EmptyGraph title="Flow Limitation" message="No flow limitation signal found for this session." />
            )}
            {graphData.leak.length > 0 ? (
              <SessionChart title="Leak Rate" unit="L/min" datasets={graphData.leak} yMin={0} theme={theme} />
            ) : (
              <EmptyGraph title="Leak Rate" message="No leak signal found for this session." />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
