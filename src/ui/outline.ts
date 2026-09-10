import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { activeHeading, headingsOf, type Heading } from "../editor/headings.ts";
import { mountComponent, type MountedComponent } from "../components/mountComponent.ts";
import { OutlineList, type OutlineListProps } from "../components/outline/OutlineList.tsx";

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
  private activeIndex = -1;
  private width = DEFAULT_WIDTH;
  private readonly list: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly vista: MountedComponent<OutlineListProps>;
  private readonly root: HTMLElement;
  private readonly view: () => EditorView;

  constructor(root: HTMLElement, view: () => EditorView) {
    this.root = root;
    this.view = view;
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
    this.vista = mountComponent<OutlineListProps>(this.list, OutlineList, {
      headings: [],
      activeIndex: -1,
      onGo: (from) => this.ir(from),
    });

    this.applyWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH);
    this.wireResizer(this.root.querySelector<HTMLElement>("#outline-resizer")!);

    this.list.addEventListener("keydown", (event) => this.alTeclado(event));
  }

  /** Lleva el cursor al encabezado y devuelve el foco al editor. */
  private ir(from: number): void {
    const view = this.view();
    view.dispatch({ selection: EditorSelection.cursor(from), scrollIntoView: true });
    view.focus();
  }

  /** Flechas para recorrer el esquema, Inicio y Fin para los extremos. */
  private alTeclado(event: KeyboardEvent): void {
    const items = [...this.list.querySelectorAll<HTMLElement>(".outline-item")];
    if (items.length === 0) return;
    const actual = items.indexOf(document.activeElement as HTMLElement);

    let destino: number;
    switch (event.key) {
      case "ArrowDown":
        destino = Math.min(actual + 1, items.length - 1);
        break;
      case "ArrowUp":
        destino = Math.max(actual - 1, 0);
        break;
      case "Home":
        destino = 0;
        break;
      case "End":
        destino = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    items[destino]?.focus();
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

  /**
   * Recalcula el esquema; barato de llamar en cada actualización del editor.
   *
   * Los encabezados se guardan siempre, no sólo cuando cambia la lista. Antes
   * se comparaba una firma de niveles y textos y, si coincidía, se conservaban
   * los de antes: pero escribir un párrafo por encima de un encabezado mueve su
   * posición sin cambiar su texto, así que las posiciones guardadas quedaban
   * viejas y pulsar en el esquema llevaba el cursor a donde ese encabezado
   * estaba, no a donde está.
   *
   * Volver a pintar en cada pulsación ya no cuesta lo que costaba: antes era
   * reescribir el panel entero con `innerHTML` —de ahí el parpadeo y el
   * desplazamiento perdido—, y ahora es una comparación que casi siempre no
   * toca nada.
   */
  refresh(): void {
    const view = this.view();
    this.headings = headingsOf(view.state);
    this.activeIndex = activeHeading(this.headings, view.state.selection.main.head);
    this.render();
  }

  private render(): void {
    this.vista.update({
      headings: this.headings,
      activeIndex: this.activeIndex,
      onGo: (from) => this.ir(from),
    });
  }

}
