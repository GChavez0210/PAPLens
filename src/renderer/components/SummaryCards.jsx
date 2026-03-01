export function SummaryCards({ summary }) {
  const averages = summary?.averages || {};
  const device = summary?.deviceInfo || {};

  const cards = [
    { label: "AVERAGE AHI", value: Number(averages.ahi || 0).toFixed(1), unit: "events/hr", subtext: "Last 30 days" },
    { label: "AVERAGE USAGE", value: Number(averages.usage || 0).toFixed(1), unit: "hours", subtext: "Per night" },
    { label: "AVERAGE PRESSURE", value: Number(averages.pressure || 0).toFixed(1), unit: "cmH2O", subtext: "95th percentile" },
    { label: "AVERAGE LEAK", value: Number(averages.leak || 0).toFixed(1), unit: "L/min", subtext: "95th percentile" },
    { label: "AVERAGE FLOW RATE", value: Number(averages.flowRate || 0).toFixed(1), unit: "L/min", subtext: "95th percentile" },
    { label: "AVERAGE TIDAL VOLUME", value: Math.round(averages.tidalVolume || 0), unit: "mL", subtext: "95th percentile" }
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
