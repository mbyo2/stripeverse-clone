import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    // WASM support for the self-custody Breez SDK – Liquid module
    // (lazy-loaded chunk only; the main bundle does not load it). The SDK is
    // initialized explicitly at runtime, so no top-level-await plugin is
    // needed (that plugin's SWC printer fails on the wasm-bindgen chunk).
    wasm(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the stable vendor code out of the entry chunk: React and
        // Supabase change far less often than app code, so repeat visitors
        // keep them cached across app deploys (assets are served immutable)
        // instead of re-downloading them inside every new entry chunk.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
  },
}));
