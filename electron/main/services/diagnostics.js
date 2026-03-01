const dns = require("dns").promises;
const net = require("net");
const { spawn } = require("child_process");

async function resolveHost(hostname) {
  const records = await dns.lookup(hostname, { all: true });
  return records;
}

function probeTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true, host, port }));
    socket.once("timeout", () => finish({ ok: false, error: "timeout", host, port }));
    socket.once("error", (error) =>
      finish({ ok: false, error: error.message || "connect_error", host, port })
    );

    socket.connect(port, host);
  });
}

function getNodeVersionFromChildProcess() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-v"], {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

module.exports = {
  resolveHost,
  probeTcp,
  getNodeVersionFromChildProcess
};
