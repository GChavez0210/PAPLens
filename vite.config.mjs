import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    base: "./",
    plugins: [
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
      minify: isProd ? 'esbuild' : false,
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
