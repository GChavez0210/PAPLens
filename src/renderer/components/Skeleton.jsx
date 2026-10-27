/** Shimmer placeholder blocks shown while lazy content loads. */
export function SkeletonPanel({ rows = 3 }) {
  return (
    <div className="panel" aria-busy="true" aria-label="Loading content">
      <div className="skeleton" style={{ height: 18, width: "34%", marginBottom: 16 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 110, marginBottom: 12 }} />
      ))}
    </div>
  );
}
