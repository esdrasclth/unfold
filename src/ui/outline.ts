import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { activeHeading, headingsOf, type Heading } from "../editor/headings.ts";

const WIDTH_KEY = "unfold:outline-width";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 170;
const MAX_WIDTH = 460;

/**
 * Esquema del documento.
 *
 * Se redibuja sólo cuando cambia la lista de encabezados, no en cada pulsación:
 * reconstruir el panel entero mientras escribes provoca parpadeo y pierde el
 * desplazamiento del propio panel.
 */
export class Outline {
  private headings: Heading[] = [];
  private signature = "";
  private activeIndex = -1;
  private width = DEFAULT_WIDTH;
  private readonly list: HTMLElement;
  private readonly inner: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly view: () => EditorView,
  ) {
    // El contenido vive en un contenedor de ancho fijo para que al plegar el
    // panel el texto no se reajuste: sólo se desplaza fuera de vista.
    this.root.innerHTML = `
      <div class="outline-inner" id="outline-inner">
        <div class="outline-head">Esquema</div>
        <nav class="outline-list" id="outline-list"></nav>
      </div>
      <div class="outline-resizer" id="outline-resizer" title="Arrastra para ajustar el ancho"></div>
    `;
    this.list = this.root.querySelector<HTMLElement>("#outline-list")!;
    this.inner = this.root.querySelector<HTMLElement>("#outline-inner")!;

    this.applyWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH);
    this.wireResizer(this.root.querySelector<HTMLElement>("#outline-resizer")!);

    this.list.addEventListener("click", (event) => {
      const item = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-from]");
      if (!item) return;
      const view = this.view();
      view.dispatch({
        selection: EditorSelection.cursor(Number(item.dataset.from)),
        scrollIntoView: true,
      });
      view.focus();
    });
  }

  /**
   * Pliega o despliega el panel.
   *
   * Anima el ancho en lugar de conmutar `display`, que corta cualquier
   * transición en seco y hacía que el panel se abriera con suavidad pero
   * desapareciera de golpe.
   */
  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle("is-collapsed", collapsed);
    // Plegado no debe recibir el foco al tabular, aunque siga en el árbol.
    if (collapsed) this.root.setAttribute("inert", "");
    else this.root.removeAttribute("inert");
  }

  private applyWidth(width: number): void {
    this.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
    const value = `${this.width}px`;
    this.root.style.setProperty("--outline-width", value);
    this.inner.style.setProperty("--outline-width", value);
  }

  private wireResizer(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const origin = this.root.getBoundingClientRect().left;

      // Durante el arrastre la transición estorba: el panel iría por detrás
      // del ratón. Y el cursor debe ser el mismo sobre toda la ventana.
      this.root.classList.add("is-resizing");
      document.body.classList.add("is-resizing");

      const move = (moveEvent: PointerEvent): void => {
        this.applyWidth(moveEvent.clientX - origin);
      };

      const end = (): void => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        this.root.classList.remove("is-resizing");
        document.body.classList.remove("is-resizing");
        localStorage.setItem(WIDTH_KEY, String(this.width));
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });

    // Doble clic devuelve el ancho de fábrica.
    handle.addEventListener("dblclick", () => {
      this.applyWidth(DEFAULT_WIDTH);
      localStorage.setItem(WIDTH_KEY, String(this.width));
    });
  }

  /** Recalcula el esquema; barato de llamar en cada actualización del editor. */
  refresh(): void {
    const view = this.view();
    const headings = headingsOf(view.state);
    const signature = headings.map((h) => `${h.level}:${h.text}`).join(" ");

    if (signature !== this.signature) {
      this.signature = signature;
      this.headings = headings;
      this.render();
    }

    this.markActive(view.state.selection.main.head);
  }

  private render(): void {
    if (this.headings.length === 0) {
      this.list.innerHTML = `<p class="outline-empty">Los encabezados del documento aparecerán aquí.</p>`;
      return;
    }

    // El nivel más alto presente marca el margen, para que un documento que
    // empieza en H2 no aparezca sangrado sin motivo.
    const top = Math.min(...this.headings.map((h) => h.level));

    this.list.innerHTML = this.headings
      .map((heading, index) => {
        const indent = Math.min(heading.level - top, 3);
        const label = heading.text || "(sin título)";
        return `<button class="outline-item level-${indent}" data-from="${heading.from}" data-index="${index}" title="${escapeAttribute(label)}">${escapeHtml(label)}</button>`;
      })
      .join("");
  }

  private markActive(pos: number): void {
    const index = activeHeading(this.headings, pos);
    if (index === this.activeIndex) return;
    this.activeIndex = index;

    for (const item of this.list.querySelectorAll<HTMLElement>(".outline-item")) {
      item.classList.toggle("is-active", Number(item.dataset.index) === index);
    }
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
