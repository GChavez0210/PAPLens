/** Shimmer placeholder blocks shown while lazy content loads. */
export function SkeletonPanel({ rows = 3 }) {
  return (
    <div className="panel" aria-busy="true" aria-label="Loading content">
      <div className="skeleton" style={{ height: 20, width: "38%", marginBottom: 14 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 120, marginBottom: 12 }} />
      ))}
    </div>
  );
}
