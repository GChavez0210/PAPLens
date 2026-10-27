import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * ChartInfoPopover — a small pinned panel that explains a clicked chart marker
 * (a scored event or a periodic-breathing episode). Shares the hovercard
 * styling with the Insights panels so the two surfaces read identically.
 *
 * Positioned fixed at the click point (viewport coordinates), then nudged back
 * inside the viewport so it never spills off an edge. Dismisses on its close
 * button, on Escape, or on an outside click.
 *
 * Props:
 *   popover  — { title, what, action, tone?, meta? } | null
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

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={popover.title}
      className={`chart-popover tone-${popover.tone || "info"}`}
      style={{ left: pos.left, top: pos.top, width: WIDTH }}
    >
      <div className="chart-popover-head">
        <span className="chart-popover-title">{popover.title}</span>
        <button type="button" className="chart-popover-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {popover.meta && <div className="chart-popover-meta">{popover.meta}</div>}

      <div className="hovercard-body">{popover.what}</div>

      {popover.action && (
        <div className="hovercard-foot">
          <span className="hovercard-foot-label">What to do</span>
          <p>{popover.action}</p>
        </div>
      )}
    </div>
  );
}
