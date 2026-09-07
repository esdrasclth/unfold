import { isTauri } from "../files.ts";

/**
 * Controles de ventana propios.
 *
 * La ventana se crea sin decoración del sistema para que la barra de título
 * no rompa la paleta de la aplicación con su gris fijo. A cambio hay que
 * reponer minimizar, maximizar y cerrar, respetando las medidas de Windows 11
 * (46×32 por botón, rojo sólo al pasar por encima del de cerrar) para que
 * sigan donde el músculo los busca.
 */

const GLYPHS = {
  minimize: '<path d="M1 6h10" />',
  maximize: '<rect x="1.5" y="1.5" width="9" height="9" rx="1" />',
  restore:
    '<path d="M3.5 3.5V2.2A.7.7 0 0 1 4.2 1.5h6.1a.7.7 0 0 1 .7.7v6.1a.7.7 0 0 1-.7.7H9.2" /><rect x="1.5" y="3.5" width="7.5" height="7.5" rx=".7" />',
  close: '<path d="m1.5 1.5 9 9M10.5 1.5l-9 9" />',
};

function glyph(name: keyof typeof GLYPHS): string {
  return `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</svg>`;
}

export function mountWindowControls(host: HTMLElement): void {
  if (!isTauri) {
    // En el navegador la ventana la gobierna el navegador.
    host.remove();
    return;
  }

  host.innerHTML = `
    <button class="window-button" id="win-min" title="Minimizar" aria-label="Minimizar">${glyph("minimize")}</button>
    <button class="window-button" id="win-max" title="Maximizar" aria-label="Maximizar">${glyph("maximize")}</button>
    <button class="window-button is-close" id="win-close" title="Cerrar" aria-label="Cerrar">${glyph("close")}</button>
  `;

  const maximizeButton = host.querySelector<HTMLButtonElement>("#win-max")!;

  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    const syncMaximized = async (): Promise<void> => {
      const maximized = await appWindow.isMaximized();
      maximizeButton.innerHTML = glyph(maximized ? "restore" : "maximize");
      maximizeButton.title = maximized ? "Restaurar" : "Maximizar";
    };

    host.querySelector("#win-min")!.addEventListener("click", () => void appWindow.minimize());
    maximizeButton.addEventListener("click", () => void appWindow.toggleMaximize());
    host.querySelector("#win-close")!.addEventListener("click", () => void appWindow.close());

    // El estado cambia también al arrastrar contra el borde o con Win+flecha.
    await appWindow.onResized(() => void syncMaximized());
    await syncMaximized();
  })();
}
