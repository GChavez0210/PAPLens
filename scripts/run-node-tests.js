const { readdirSync } = require("fs");
const { join } = require("path");
const { spawnSync } = require("child_process");

function findTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

const testFiles = findTestFiles(join(__dirname, "..", "electron", "main"));
const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
