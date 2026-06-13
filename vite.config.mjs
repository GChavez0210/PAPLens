import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// src/shared/* are CommonJS so the main process can require them. The build
// handles that via commonjsOptions below, but the dev server serves source
// files untransformed, so named imports from those files break under
// `npm run dev`. This dev-only plugin rewrites their single trailing
// `module.exports = { ... }` into ESM named exports. It relies on that exact
// authoring pattern (plain identifier lists, no nested braces, no requires) —
// keep shared modules in that shape.
const sharedCjsDevInterop = {
  name: "shared-cjs-dev-interop",
  apply: "serve",
  transform(code, id) {
    if (!/src[\\/]shared[\\/][^\\/]+\.js$/.test(id) || id.endsWith(".test.js")) {
      return null;
    }
    const match = code.match(/module\.exports\s*=\s*\{([^{}]*)\};?/);
    if (!match) {
      return null;
    }
    const names = match[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, local] = entry.split(":").map((part) => part.trim());
        return local && local !== key ? `${local} as ${key}` : key;
      });
    const stripped = code.replace(match[0], "").replace(/^"use strict";\s*/, "");
    return { code: `${stripped}\nexport { ${names.join(", ")} };\n`, map: null };
  }
};

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    base: "./",
    plugins: [
      sharedCjsDevInterop,
      react()
    ],
    build: {
      // src/shared/* are CommonJS (so the CJS main process can require them too).
      // Rollup only runs @rollup/plugin-commonjs on node_modules by default, so opt
      // the shared dir in to let the production build resolve its named exports.
      commonjsOptions: {
        include: [/node_modules/, /src[\\/]shared[\\/]/]
      },
      outDir: "dist/renderer",
      emptyOutDir: true,
      sourcemap: !isProd, // hide source maps in prod
      minify: isProd ? 'oxc' : false, // Vite 8 (rolldown) uses oxc, not esbuild
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("react") || id.includes("react-dom")) {
                return "react-vendor";
              }
              if (id.includes("chart.js")) {
                return "chart-vendor";
              }
              return "vendor";
            }
          }
        }
      }
    }
  };
});
