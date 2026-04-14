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
