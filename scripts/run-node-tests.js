const { existsSync, mkdirSync, readdirSync, rmSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");
const { spawnSync } = require("child_process");
const esbuild = require("esbuild");

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

const root = join(__dirname, "..");
const testFiles = findTestFiles(join(root, "electron", "main"));
const rendererTestRoot = join(root, "src", "renderer");
const rendererTestFiles = existsSync(rendererTestRoot) ? findTestFiles(rendererTestRoot) : [];

if (rendererTestFiles.length > 0) {
  const outDir = join(tmpdir(), "paplens-renderer-tests");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (let i = 0; i < rendererTestFiles.length; i++) {
    esbuild.buildSync({
      entryPoints: [rendererTestFiles[i]],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: join(outDir, `renderer-${i}.test.cjs`),
      external: ["node:test", "node:assert/strict"]
    });
    testFiles.push(join(outDir, `renderer-${i}.test.cjs`));
  }
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
