import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * ChartInfoPopover — a small pinned panel that explains a clicked chart marker
 * (a scored event or a periodic-breathing episode). Mirrors the styling of the
 * PeriodicBreathingCard hover tooltip so the two surfaces read identically.
 *
 * Positioned fixed at the click point (viewport coordinates), then nudged back
 * inside the viewport so it never spills off an edge. Dismisses on its close
 * button, on Escape, or on an outside click.
 *
 * Props:
 *   popover  — { title, what, action, accent, meta? } | null
 *   anchor   — { x, y } viewport pixel coordinates of the click
 *   onClose  — callback
 */
const WIDTH = 320;

export function ChartInfoPopover({ popover, anchor, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Clamp the panel inside the viewport once it has measured its own height.
  useLayoutEffect(() => {
    if (!popover || !anchor) return;
    const margin = 12;
    const el = ref.current;
    const height = el ? el.offsetHeight : 180;
    let left = anchor.x + 14;
    if (left + WIDTH + margin > window.innerWidth) left = anchor.x - WIDTH - 14;
    left = Math.max(margin, Math.min(left, window.innerWidth - WIDTH - margin));
    let top = anchor.y - 8;
    if (top + height + margin > window.innerHeight) top = window.innerHeight - height - margin;
    top = Math.max(margin, top);
    setPos({ left, top });
  }, [popover, anchor]);

  // Outside-click + Escape dismissal. Escape is captured so it closes the
  // popover before the modal's own Escape-to-close handler fires.
  useEffect(() => {
    if (!popover) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [popover, onClose]);

  if (!popover) return null;
  const accent = popover.accent || "var(--accent, #22D3EE)";

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={popover.title}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: WIDTH,
        zIndex: 1000,
        background: "var(--card)",
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 10,
        padding: "14px 16px",
        fontSize: "0.78rem",
        color: "var(--text)",
        lineHeight: 1.6,
        boxShadow: "0 16px 48px rgba(0,0,0,0.55)"
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700, color: accent, fontSize: "0.86rem" }}>{popover.title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            border: "none", background: "transparent", color: "var(--muted)",
            cursor: "pointer", fontSize: "0.95rem", lineHeight: 1, padding: 2, marginTop: -2
          }}
        >
          ✕
        </button>
      </div>

      {popover.meta && (
        <div style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: 2, marginBottom: 6 }}>
          {popover.meta}
        </div>
      )}

      <div style={{ color: "var(--muted)", marginTop: popover.meta ? 0 : 8 }}>{popover.what}</div>

      {popover.action && (
        <div style={{ borderTop: `1px solid ${accent}40`, paddingTop: 8, marginTop: 10 }}>
          <span style={{ fontWeight: 700, color: accent, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 1 }}>
            What to do
          </span>
          <div style={{ color: "var(--text)", marginTop: 4 }}>{popover.action}</div>
        </div>
      )}
    </div>
  );
}
