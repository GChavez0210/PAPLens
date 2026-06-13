import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { baseLegend, baseTooltip, chartColors, formatAxisTick } from "../charts/chartTheme";

const MAX_POINTS = 1800;
// Smallest zoom window (minutes) for the daily session graphs.
const MIN_ZOOM_MINUTES = 0.5;

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

function toLeakLitersPerMinute(values) {
  return (values || []).map((value) => Number(value) * 60);
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

function SessionChart({ title, unit, datasets, yMin, yMax, theme, xRange, yTickLabel, tooltipLabel, externalPlugins, maxMinutes, onRangeChange }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  // Keep the latest formatter callbacks and interaction inputs in refs so the
  // chart is rebuilt only when its structure changes — never on zoom/pan, which
  // would cause a visible flicker. Zoom updates are applied to scales in place.
  const tooltipLabelRef = useRef(tooltipLabel);
  const yTickLabelRef = useRef(yTickLabel);
  const maxMinutesRef = useRef(maxMinutes);
  const onRangeChangeRef = useRef(onRangeChange);
  tooltipLabelRef.current = tooltipLabel;
  yTickLabelRef.current = yTickLabel;
  maxMinutesRef.current = maxMinutes;
  onRangeChangeRef.current = onRangeChange;

  // Build the chart when its structure (data / theme / axes) changes.
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const colors = chartColors(theme);
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
            min: xRange?.start,
            max: xRange?.end,
            title: { display: true, text: "Elapsed time", color: colors.mutedText },
            ticks: {
              color: colors.text,
              callback: (value) => formatElapsed(Number(value) * 60),
              maxTicksLimit: 7,
              font: { size: 11, weight: "500" }
            },
            grid: { color: colors.grid, tickLength: 0 },
            border: { color: colors.axis }
          },
          y: {
            min: yMin,
            max: yMax,
            title: { display: Boolean(unit), text: unit, color: colors.mutedText },
            ticks: {
              color: colors.text,
              font: { size: 11, weight: "500" },
              callback: (value) => (yTickLabelRef.current ? yTickLabelRef.current(value) : formatAxisTick(value))
            },
            grid: { color: colors.grid, tickLength: 0 },
            border: { color: colors.axis }
          }
        },
        plugins: {
          legend: baseLegend(theme),
          tooltip: {
            ...baseTooltip(theme),
            callbacks: {
              title: (items) => (items[0] ? formatElapsed(items[0].parsed.x * 60) : ""),
              label: (item) => tooltipLabelRef.current ? tooltipLabelRef.current(item) : `${item.dataset.label}: ${Number(item.parsed.y).toFixed(2)}${unit ? ` ${unit}` : ""}`
            }
          }
        }
      }
    });

    return () => chartRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets, externalPlugins, theme, unit, yMin, yMax]);

  // Apply the shared zoom window in place (no rebuild) whenever it changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.options.scales.x.min = xRange?.start;
    chart.options.scales.x.max = xRange?.end;
    chart.update("none");
  }, [xRange]);

  // Direct-manipulation zoom (wheel) and pan (drag), bound once per mount.
  // All charts share one range via onRangeChange, so any chart drives them all.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const clampSpan = (span) => {
      const max = Math.max(1, maxMinutesRef.current || 1);
      return Math.min(Math.max(MIN_ZOOM_MINUTES, span), max);
    };

    const onWheel = (e) => {
      // Only zoom when Ctrl/Cmd is held, so a plain wheel scrolls the modal
      // past the graphs without accidentally zooming them.
      if (!e.ctrlKey && !e.metaKey) return;
      const chart = chartRef.current;
      const max = maxMinutesRef.current;
      if (!chart || !max) return;
      e.preventDefault();
      const scale = chart.scales.x;
      const rect = canvas.getBoundingClientRect();
      const focus = scale.getValueForPixel(e.clientX - rect.left);
      const curMin = scale.min ?? 0;
      const curMax = scale.max ?? max;
      const span = curMax - curMin;
      const nextSpan = clampSpan(span * (e.deltaY > 0 ? 1.25 : 0.8));
      if (nextSpan >= max) {
        onRangeChangeRef.current(null);
        return;
      }
      const ratio = span > 0 ? (focus - curMin) / span : 0.5;
      onRangeChangeRef.current(clampRange(focus - ratio * nextSpan, nextSpan, max));
    };

    let dragging = false;
    let startX = 0;
    let snapMin = 0;
    let snapSpan = 0;
    let minPerPx = 0;

    const onPointerDown = (e) => {
      const chart = chartRef.current;
      const max = maxMinutesRef.current;
      if (!chart || !max || e.button !== 0) return;
      const scale = chart.scales.x;
      const curMin = scale.min ?? 0;
      const curMax = scale.max ?? max;
      snapSpan = curMax - curMin;
      if (snapSpan >= max) return; // already showing the full session — nothing to pan
      dragging = true;
      startX = e.clientX;
      snapMin = curMin;
      minPerPx = snapSpan / (scale.right - scale.left);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      const deltaMin = -(e.clientX - startX) * minPerPx;
      onRangeChangeRef.current(clampRange(snapMin + deltaMin, snapSpan, maxMinutesRef.current));
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = "";
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
    };
  }, []);

  return (
    <section className="session-graph-card">
      <h3>{title}</h3>
      <div className="session-graph-canvas">
        <canvas ref={canvasRef} />
      </div>
    </section>
  );
}

/**
 * MiniSparkline — a faint area sketch of one signal across the whole session,
 * drawn behind the minimap window so the user can orient the zoom selection.
 */
function MiniSparkline({ points, maxMinutes, theme }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !points || points.length === 0 || !maxMinutes) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const span = maxY - minY || 1;
    const xOf = (m) => (m / maxMinutes) * w;
    const yOf = (v) => h - 3 - ((v - minY) / span) * (h - 6);

    ctx.beginPath();
    ctx.moveTo(xOf(points[0].x), h);
    for (const p of points) ctx.lineTo(xOf(p.x), yOf(p.y));
    ctx.lineTo(xOf(points[points.length - 1].x), h);
    ctx.closePath();
    const accent = theme === "light" ? "rgba(79,70,229,0.16)" : "rgba(34,211,238,0.16)";
    ctx.fillStyle = accent;
    ctx.fill();
  }, [points, maxMinutes, theme]);

  return <canvas ref={canvasRef} className="session-minimap-spark" />;
}

/**
 * SessionMinimap — full-session overview strip with a draggable / resizable
 * window. Dragging the window body pans; dragging an edge handle resizes;
 * clicking the track centers the current window there. Reports the new range
 * through onRangeChange (null === fit to full session).
 */
function SessionMinimap({ maxMinutes, range, points, theme, onRangeChange }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);

  const start = range ? range.start : 0;
  const end = range ? range.end : maxMinutes;

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      const track = trackRef.current;
      if (!d || !track) return;
      const rect = track.getBoundingClientRect();
      const deltaMin = ((e.clientX - d.startX) / rect.width) * maxMinutes;
      if (d.mode === "move") {
        const span = d.origEnd - d.origStart;
        onRangeChange(clampRange(d.origStart + deltaMin, span, maxMinutes));
        return;
      }
      let s = d.origStart;
      let en = d.origEnd;
      if (d.mode === "left") s = Math.min(Math.max(0, d.origStart + deltaMin), d.origEnd - MIN_ZOOM_MINUTES);
      if (d.mode === "right") en = Math.max(Math.min(maxMinutes, d.origEnd + deltaMin), d.origStart + MIN_ZOOM_MINUTES);
      onRangeChange(clampRange(s, en - s, maxMinutes));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [maxMinutes, onRangeChange]);

  const beginDrag = (mode) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { mode, startX: e.clientX, origStart: start, origEnd: end };
  };

  const onTrackDown = (e) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const clickMin = Math.min(maxMinutes, Math.max(0, ((e.clientX - rect.left) / rect.width) * maxMinutes));
    const span = range ? range.end - range.start : Math.min(maxMinutes, 15);
    onRangeChange(clampRange(clickMin - span / 2, span, maxMinutes));
  };

  const leftPct = (start / maxMinutes) * 100;
  const widthPct = ((end - start) / maxMinutes) * 100;

  return (
    <div className="session-minimap">
      <div className="session-minimap-track" ref={trackRef} onPointerDown={onTrackDown}>
        <MiniSparkline points={points} maxMinutes={maxMinutes} theme={theme} />
        <div
          className="session-minimap-window"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onPointerDown={beginDrag("move")}
          role="slider"
          aria-label="Visible time window"
          aria-valuemin={0}
          aria-valuemax={Math.round(maxMinutes)}
          aria-valuenow={Math.round(start)}
          tabIndex={0}
        >
          <span className="session-minimap-handle left" onPointerDown={beginDrag("left")} />
          <span className="session-minimap-handle right" onPointerDown={beginDrag("right")} />
        </div>
      </div>
      <div className="session-minimap-labels">
        <span>{formatElapsed(0)}</span>
        <span>{formatElapsed(maxMinutes * 60)}</span>
      </div>
    </div>
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

function getGraphMaxMinutes(graphData) {
  const groups = [
    graphData.pressure,
    graphData.flow,
    graphData.amplitude,
    graphData.flowLimitation,
    graphData.leak
  ];
  let max = 0;
  for (const datasets of groups) {
    for (const dataset of datasets || []) {
      for (const point of dataset?.data || []) {
        const x = Number(point?.x);
        if (Number.isFinite(x)) max = Math.max(max, x);
      }
    }
  }
  return max;
}

function clampRange(start, span, maxMinutes) {
  const safeMax = Math.max(1, maxMinutes || 1);
  const safeSpan = Math.min(Math.max(1, span), safeMax);
  const safeStart = Math.min(Math.max(0, start), Math.max(0, safeMax - safeSpan));
  return { start: safeStart, end: safeStart + safeSpan };
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
  const [zoomRange, setZoomRange] = useState(null);

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
    setZoomRange(null);
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
              data: buildPoints(toLeakLitersPerMinute(leak.values), pld),
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

  const maxGraphMinutes = useMemo(() => getGraphMaxMinutes(graphData), [graphData]);
  const activeZoomLabel = zoomRange
    ? `${formatElapsed(zoomRange.start * 60)} - ${formatElapsed(zoomRange.end * 60)}`
    : "Fit session";
  const zoomSelectValue = (() => {
    if (!zoomRange) return "fit";
    const span = zoomRange.end - zoomRange.start;
    for (const option of [1, 5, 15, 60]) {
      if (Math.abs(span - option) < 0.05) return String(option);
    }
    return "custom";
  })();

  // A single sketch signal for the minimap backdrop — prefer the smooth tidal
  // amplitude, then pressure, then raw flow.
  const minimapPoints = useMemo(() => (
    graphData.amplitude?.[0]?.data
    || graphData.pressure?.[0]?.data
    || graphData.flow?.[0]?.data
    || []
  ), [graphData]);

  // Shared range setter used by the charts (wheel/drag) and the minimap.
  // Collapsing to a full-session range resets to "fit" (null).
  const applyRange = useCallback((range) => {
    if (!range || (range.start <= 0.001 && range.end >= maxGraphMinutes - 0.001)) {
      setZoomRange(null);
    } else {
      setZoomRange(range);
    }
  }, [maxGraphMinutes]);

  const setZoomWindow = (minutes) => {
    if (!minutes || !maxGraphMinutes) {
      setZoomRange(null);
      return;
    }
    const center = zoomRange
      ? (zoomRange.start + zoomRange.end) / 2
      : maxGraphMinutes / 2;
    setZoomRange(clampRange(center - minutes / 2, minutes, maxGraphMinutes));
  };

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

          <div className="session-modal-actions">
            {maxGraphMinutes > 0 && (
              <div className="session-zoom-controls" aria-label="Session graph zoom window">
                <span className="session-control-label">Window</span>
                <select
                  value={zoomSelectValue}
                  onChange={(e) => setZoomWindow(e.target.value === "fit" ? null : Number(e.target.value))}
                  aria-label="Choose zoom window"
                >
                  <option value="fit">Fit session</option>
                  <option value="custom" disabled>Custom window</option>
                  <option value="1">1 min</option>
                  <option value="5">5 min</option>
                  <option value="15">15 min</option>
                  <option value="60">1 hr</option>
                </select>
              </div>
            )}

            {/* Session picker — only shown when multiple sessions exist for the day */}
            {sessions.length > 1 && (
              <div className="session-picker">
                <span className="session-control-label">Session</span>
                <select
                  value={activeIdx}
                  onChange={(e) => setActiveIdx(Number(e.target.value))}
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
          </div>
        </header>

        {detail && !detail.error && maxGraphMinutes > 0 && (
          <div className="session-minimap-bar">
            <div className="session-minimap-meta">
              <span className="session-minimap-hint">Ctrl + scroll to zoom · drag a graph to pan · drag the window</span>
              <span className="session-zoom-readout">{activeZoomLabel}</span>
            </div>
            <SessionMinimap
              maxMinutes={maxGraphMinutes}
              range={zoomRange}
              points={minimapPoints}
              theme={theme}
              onRangeChange={applyRange}
            />
          </div>
        )}

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
                xRange={zoomRange}
                maxMinutes={maxGraphMinutes}
                onRangeChange={applyRange}
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
              <SessionChart title="Flow Rate" unit="L/min" datasets={graphData.flow} theme={theme} xRange={zoomRange} maxMinutes={maxGraphMinutes} onRangeChange={applyRange} />
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
                xRange={zoomRange}
                maxMinutes={maxGraphMinutes}
                onRangeChange={applyRange}
                externalPlugins={graphData.pbPlugin ? [graphData.pbPlugin] : []}
              />
            ) : null}
            {graphData.flowLimitation.length > 0 ? (
              <SessionChart title="Flow Limitation" unit="index" datasets={graphData.flowLimitation} yMin={0} yMax={1} theme={theme} xRange={zoomRange} maxMinutes={maxGraphMinutes} onRangeChange={applyRange} />
            ) : (
              <EmptyGraph title="Flow Limitation" message="No flow limitation signal found for this session." />
            )}
            {graphData.leak.length > 0 ? (
              <SessionChart title="Leak Rate" unit="L/min" datasets={graphData.leak} yMin={0} theme={theme} xRange={zoomRange} maxMinutes={maxGraphMinutes} onRangeChange={applyRange} />
            ) : (
              <EmptyGraph title="Leak Rate" message="No leak signal found for this session." />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
