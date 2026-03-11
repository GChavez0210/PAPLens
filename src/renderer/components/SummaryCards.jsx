import { formatMetricValue } from "../utils/therapyMetrics";

export function SummaryCards({ summary }) {
  const averages = summary?.averages || {};
  const device = summary?.deviceInfo || {};

  const cards = [
    { label: "AVERAGE AHI", value: formatMetricValue(averages.ahi, 1), unit: "events/hr", subtext: "Last 30 days" },
    { label: "AVERAGE USAGE", value: formatMetricValue(averages.usage, 1), unit: "hours", subtext: "Per night" },
    { label: "AVERAGE PRESSURE", value: formatMetricValue(averages.pressure, 1), unit: "cmH2O", subtext: "95th percentile" },
    { label: "AVERAGE LEAK", value: formatMetricValue(averages.leak, 1), unit: "L/min", subtext: "95th percentile" },
    { label: "AVERAGE FLOW RATE", value: formatMetricValue(averages.flowRate, 1), unit: "L/min", subtext: "95th percentile" },
    { label: "AVERAGE TIDAL VOLUME", value: formatMetricValue(averages.tidalVolume, 0), unit: "mL", subtext: "50th percentile" }
  ];

  return (
    <>
      <section className="device-card">
        <h2>Device</h2>
        <p>{device.productName || "Unknown device"}</p>
        <p>Serial: {device.serialNumber || "Unknown"}</p>
        <p>Firmware: {device.firmwareVersion || "Unknown"}</p>
      </section>
      <section className="cards-grid" style={{ display: "flex", gap: "10px", flexWrap: "nowrap", overflowX: "auto" }}>
        {cards.map((card) => (
          <article className="stat-card" key={card.label} style={{ flex: 1, minWidth: "180px", background: "var(--panel-bg)", padding: "15px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <h3 style={{ fontSize: "0.75em", color: "var(--muted)", margin: "0 0 10px 0", textTransform: "uppercase", letterSpacing: "1px" }}>{card.label}</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: "5px", marginBottom: "5px" }}>
              <strong style={{ fontSize: "1.8em", color: "white" }}>{card.value}</strong>
              <span style={{ fontSize: "0.8em", color: "var(--muted)" }}>{card.unit}</span>
            </div>
            <div style={{ fontSize: "0.75em", color: "var(--muted)" }}>{card.subtext}</div>
          </article>
        ))}
      </section>
    </>
  );
}
