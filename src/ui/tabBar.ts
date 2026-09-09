import type { Tab } from "../tabs.ts";

export interface TabBarHandlers {
  activate: (id: number) => void;
  close: (id: number) => void;
}

/**
 * Barra de pestañas.
 *
 * Sólo aparece con dos o más documentos abiertos: con uno solo repetiría el
 * nombre que ya está en la barra de título y añadiría una franja vacía a una
 * interfaz que quiere estar despejada.
 */
export class TabBar {
  constructor(
    private readonly root: HTMLElement,
    handlers: TabBarHandlers,
  ) {
    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const close = target?.closest<HTMLElement>("[data-close]");
      if (close) {
        event.stopPropagation();
        handlers.close(Number(close.dataset.close));
        return;
      }
      const tab = target?.closest<HTMLElement>("[data-tab]");
      if (tab) handlers.activate(Number(tab.dataset.tab));
    });

    // El botón central del ratón cierra, como en cualquier navegador.
    this.root.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tab]");
      if (tab) {
        event.preventDefault();
        handlers.close(Number(tab.dataset.tab));
      }
    });
  }

  /**
   * Dibuja la barra.
   *
   * Se ve siempre, también con un solo documento. Antes se escondía por no
   * repetir el nombre que ya estaba en la barra de título, pero eso dejaba la
   * única pestaña sin su aspa: no había forma de cerrarla con el ratón.
   * Cerrar la última no vacía la aplicación; deja un documento en blanco.
   */
  render(tabs: readonly Tab[], activeId: number): void {
    this.root.hidden = false;
    this.root.innerHTML = tabs
      .map((tab) => {
        const active = tab.id === activeId ? " is-active" : "";
        const dirty = tab.dirty ? " is-dirty" : "";
        return `<div class="tab${active}${dirty}" data-tab="${tab.id}" title="${escapeAttribute(tab.path ?? tab.name)}">
            <span class="tab-name">${escapeHtml(tab.name)}</span>
            <button class="tab-close" data-close="${tab.id}" title="Cerrar (Ctrl+W)" aria-label="Cerrar ${escapeAttribute(tab.name)}">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="m3 3 6 6M9 3l-6 6"/></svg>
            </button>
          </div>`;
      })
      .join("");

    // La pestaña activa siempre a la vista aunque la barra se desborde.
    this.root.querySelector(".tab.is-active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
