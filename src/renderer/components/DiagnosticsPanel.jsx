import { useState } from "react";

export function DiagnosticsPanel() {
  const [hostname, setHostname] = useState("localhost");
  const [port, setPort] = useState("80");
  const [result, setResult] = useState("");

  const runResolve = async () => {
    const data = await window.diagAPI.resolveHost(hostname);
    setResult(JSON.stringify(data, null, 2));
  };

  const runProbe = async () => {
    const data = await window.diagAPI.tcpProbe(hostname, Number(port), 3000);
    setResult(JSON.stringify(data, null, 2));
  };

  const runNodeVersion = async () => {
    const data = await window.diagAPI.nodeVersion();
    setResult(JSON.stringify(data, null, 2));
  };

  return (
    <section className="diag-card">
      <h2>Diagnostics (dns.promises / net / child_process)</h2>
      <div className="diag-controls">
        <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="hostname" />
        <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="port" />
        <button onClick={runResolve}>Resolve DNS</button>
        <button onClick={runProbe}>Probe TCP</button>
        <button onClick={runNodeVersion}>Node Child Process</button>
      </div>
      <pre>{result || "No diagnostics run yet."}</pre>
    </section>
  );
}
