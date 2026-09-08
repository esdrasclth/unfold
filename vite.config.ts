import { defineConfig } from "vite";
import packageInfo from "./package.json" with { type: "json" };
import release from "./src/release.json" with { type: "json" };
import tauriConfig from "./src-tauri/tauri.conf.json" with { type: "json" };

const versions = new Set([packageInfo.version, tauriConfig.version, release.version]);
if (versions.size !== 1) {
  throw new Error(
    "Las versiones de package.json, tauri.conf.json y src/release.json deben coincidir. " +
      "Actualiza también las novedades antes de compilar.",
  );
}

// Tauri sirve la UI desde un puerto fijo y espera que el proceso de Vite
// no intente reubicarse si está ocupado.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // WebView2 en Windows es Chromium reciente: no hace falta transpilar hacia atrás.
  build: {
    target: "chrome110",
    sourcemap: true,
  },
});
