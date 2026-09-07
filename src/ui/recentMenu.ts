import { folderOf, forgetRecent, loadRecent, whenLabel } from "../recent.ts";

export interface RecentMenuHandlers {
  open: (path: string) => void;
  browse: () => void;
}

/**
 * Menú de archivos recientes, anclado al botón que lo abre.
 *
 * Se construye al desplegarlo y no al arrancar: la lista cambia con cada
 * archivo que se abre, y así no hay que mantenerla sincronizada.
 */
export class RecentMenu {
  private readonly root: HTMLElement;
  private open = false;

  constructor(
    private readonly anchor: HTMLElement,
    private readonly handlers: RecentMenuHandlers,
  ) {
    this.root = document.createElement("div");
    this.root.className = "menu";
    this.root.hidden = true;
    document.body.appendChild(this.root);

    this.root.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;

      const forget = target?.closest<HTMLElement>("[data-forget]");
      if (forget) {
        event.stopPropagation();
        forgetRecent(forget.dataset.forget!);
        this.render();
        return;
      }

      const item = target?.closest<HTMLElement>("[data-path]");
      if (item) {
        this.hide();
        this.handlers.open(item.dataset.path!);
        return;
      }

      if (target?.closest("[data-browse]")) {
        this.hide();
        this.handlers.browse();
      }
    });

    // Cerrar al pulsar fuera o con Escape.
    document.addEventListener("mousedown", (event) => {
      if (!this.open) return;
      const node = event.target as Node;
      if (!this.root.contains(node) && !this.anchor.contains(node)) this.hide();
    });
    document.addEventListener("keydown", (event) => {
      if (this.open && event.key === "Escape") {
        event.preventDefault();
        this.hide();
      }
    });
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  private show(): void {
    this.render();
    this.root.hidden = false;
    this.open = true;

    // Anclado bajo el botón y sin salirse por la derecha de la ventana.
    const box = this.anchor.getBoundingClientRect();
    const width = this.root.offsetWidth;
    const left = Math.min(box.left, window.innerWidth - width - 8);
    this.root.style.left = `${Math.max(8, left)}px`;
    this.root.style.top = `${box.bottom + 4}px`;
    this.anchor.classList.add("is-on");
  }

  hide(): void {
    this.root.hidden = true;
    this.open = false;
    this.anchor.classList.remove("is-on");
  }

  private render(): void {
    const files = loadRecent();
    const items = files
      .map(
        (file) => `
        <button class="menu-item" data-path="${escapeAttribute(file.path)}" title="${escapeAttribute(file.path)}">
          <span class="menu-item-name">${escapeHtml(file.name)}</span>
          <span class="menu-item-meta">${escapeHtml(folderOf(file.path))} · ${escapeHtml(whenLabel(file.opened))}</span>
          <span class="menu-item-forget" data-forget="${escapeAttribute(file.path)}" title="Quitar de la lista" role="button">×</span>
        </button>`,
      )
      .join("");

    this.root.innerHTML = `
      <div class="menu-head">Recientes</div>
      ${items || '<p class="menu-empty">Todavía no has abierto ningún archivo.</p>'}
      <button class="menu-item is-action" data-browse>Buscar en el disco…</button>
    `;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
