import { defineConfig } from "vite";

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
