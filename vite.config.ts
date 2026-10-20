import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
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
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
