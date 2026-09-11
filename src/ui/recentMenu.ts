import { forgetRecent, loadRecent } from "../recent.ts";
import { mountComponent, type MountedComponent } from "../components/mountComponent.ts";
import { RecentMenu as RecentMenuView, type RecentMenuProps } from "../components/recent/RecentMenu.tsx";

export interface RecentMenuHandlers {
  open: (path: string) => void;
  browse: () => void;
  /** Mantiene al armazón declarativo al tanto del estado del menú. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Menú de archivos recientes, anclado al botón que lo abre.
 *
 * La lista es un componente Preact; aquí quedan las cosas que no son pintar:
 * abrir y cerrar, colocarlo bajo su botón sin que se salga de la ventana,
 * cerrarlo al pulsar fuera y llevar el foco.
 *
 * Se pinta al desplegarlo y no al arrancar, porque la lista cambia con cada
 * archivo que se abre y así no hay que mantenerla al día.
 *
 * El teclado es nuevo: antes se podía tabular hasta las filas pero no había
 * forma de recorrerlas, y al cerrar con Escape el foco se quedaba perdido en
 * un menú que ya no existía.
 */
export class RecentMenu {
  private readonly root: HTMLElement;
  private readonly vista: MountedComponent<RecentMenuProps>;
  private readonly anchor: HTMLElement;
  private readonly handlers: RecentMenuHandlers;
  private open = false;

  constructor(anchor: HTMLElement, handlers: RecentMenuHandlers) {
    this.anchor = anchor;
    this.handlers = handlers;

    this.root = document.createElement("div");
    this.root.className = "menu";
    this.root.hidden = true;
    this.root.setAttribute("role", "menu");
    this.root.setAttribute("aria-label", "Documentos recientes");
    document.body.append(this.root);

    this.vista = mountComponent<RecentMenuProps>(this.root, RecentMenuView, this.props());

    this.root.addEventListener("keydown", (event) => this.alTeclado(event));

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
        // El foco vuelve a donde estaba: dejarlo dentro de un menú escondido
        // deja al teclado sin sitio desde el que seguir.
        this.anchor.focus();
      }
    });
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  hide(): void {
    this.root.hidden = true;
    this.open = false;
    this.anchor.classList.remove("is-on");
    this.handlers.onOpenChange?.(false);
  }

  private props(): RecentMenuProps {
    return {
      files: loadRecent(),
      onOpen: (path) => {
        this.hide();
        this.handlers.open(path);
      },
      onForget: (path) => {
        forgetRecent(path);
        this.render();
      },
      onBrowse: () => {
        this.hide();
        this.handlers.browse();
      },
    };
  }

  private render(): void {
    this.vista.update(this.props());
  }

  private show(): void {
    this.render();
    this.root.hidden = false;
    this.open = true;
    this.handlers.onOpenChange?.(true);

    // Anclado bajo el botón y sin salirse por la derecha de la ventana.
    const box = this.anchor.getBoundingClientRect();
    const width = this.root.offsetWidth;
    const left = Math.min(box.left, window.innerWidth - width - 8);
    this.root.style.left = `${Math.max(8, left)}px`;
    this.root.style.top = `${box.bottom + 4}px`;
    this.anchor.classList.add("is-on");

    this.opciones()[0]?.focus();
  }

  private opciones(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }

  /** Flechas para recorrer, Inicio y Fin para los extremos; las dos dan vuelta. */
  private alTeclado(event: KeyboardEvent): void {
    const opciones = this.opciones();
    if (opciones.length === 0) return;
    const actual = opciones.indexOf(document.activeElement as HTMLElement);

    let destino: number;
    switch (event.key) {
      case "ArrowDown":
        destino = (actual + 1) % opciones.length;
        break;
      case "ArrowUp":
        destino = (actual - 1 + opciones.length) % opciones.length;
        break;
      case "Home":
        destino = 0;
        break;
      case "End":
        destino = opciones.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    opciones[destino]?.focus();
  }
}
