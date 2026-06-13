/**
 * SVG progress ring for therapy stability scores (0-100).
 * Tier colors come from CSS classes driven by theme variables so the ring
 * renders correctly in both dark and light modes. An explicit `stroke`
 * overrides the tier color (used where a caller computes its own tier).
 */

export function scoreTierClass(score) {
  if (score == null || Number.isNaN(score)) return "";
  const s = Math.round(score);
  if (s === 100) return "ring-blue";
  if (s >= 85) return "ring-green";
  if (s >= 75) return "ring-yellow";
  if (s >= 50) return "ring-orange";
  return "ring-red";
}

export function ScoreRing({ score, size = 100, strokeWidth = 7, label = "Score", stroke }) {
  const s = score == null || Number.isNaN(Number(score)) ? null : Math.round(score);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const frac = s == null ? 0 : Math.max(0, Math.min(1, s / 100));
  const half = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`score-ring ${stroke ? "" : scoreTierClass(s)}`}
      role="img"
      aria-label={s == null ? "No score available" : `Score ${s} out of 100`}
    >
      <circle className="score-ring-track" cx={half} cy={half} r={r} strokeWidth={strokeWidth} />
      {s != null && (
        <circle
          className="score-ring-arc"
          cx={half}
          cy={half}
          r={r}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${(frac * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
          transform={`rotate(-90 ${half} ${half})`}
          style={stroke ? { stroke } : undefined}
        />
      )}
      <text
        className="score-ring-value"
        x={half}
        y={half - size * 0.04}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.27}
      >
        {s == null ? "–" : s}
      </text>
      <text
        className="score-ring-label"
        x={half}
        y={half + size * 0.2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.max(size * 0.085, 9)}
      >
        {label}
      </text>
    </svg>
  );
}
