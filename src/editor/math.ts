import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/*
 * KaTeX se carga la primera vez que hay una fórmula que pintar, no al abrir la
 * aplicación. Son doscientos cincuenta kilobytes más su hoja de estilos y sus
 * tipografías, y la mayoría de los documentos Markdown no llevan una sola
 * fórmula: pagarlo en cada arranque para el caso raro va contra lo único que
 * esta aplicación promete de verdad, que es abrirse rápido.
 *
 * Mermaid ya se cargaba así; esto lo iguala.
 */
type Katex = typeof import("katex").default;

let katex: Katex | null = null;
let cargando: Promise<Katex | null> | null = null;

function cargarKatex(): Promise<Katex | null> {
  cargando ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
    .then(([modulo]) => (katex = modulo.default))
    .catch((error) => {
      console.error("No se pudo cargar KaTeX", error);
      return null;
    });
  return cargando;
}

/** Pinta la fórmula dentro del hueco, o deja el TeX si KaTeX no puede con ella. */
function pintar(wrap: HTMLElement, motor: Katex, tex: string, block: boolean): void {
  try {
    // `throwOnError: false` deja el error dentro de la fórmula en vez de
    // romper el render: escribiendo TeX se pasa por muchos estados inválidos.
    wrap.innerHTML = motor.renderToString(tex, {
      displayMode: block,
      throwOnError: false,
      output: "html",
      strict: false,
    });
    wrap.classList.remove("is-broken");
  } catch {
    wrap.textContent = tex;
    wrap.classList.add("is-broken");
  }
}

/** Fórmula renderizada. Sustituye al TeX mientras el cursor está fuera. */
export class MathWidget extends WidgetType {
  // Campos explícitos y no propiedades de parámetro: Node no las admite al
  // despojar tipos, y sin eso este módulo no se puede probar sin navegador.
  private readonly tex: string;
  private readonly block: boolean;
  /** Posición a la que llevar el cursor al pulsarla. */
  private readonly from: number;

  constructor(tex: string, block: boolean, from: number) {
    super();
    this.tex = tex;
    this.block = block;
    this.from = from;
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.block === this.block && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement(this.block ? "div" : "span");
    wrap.className = this.block ? "cm-md-math is-block" : "cm-md-math";

    if (katex) {
      pintar(wrap, katex, this.tex, this.block);
    } else {
      // Mientras llega el motor se enseña el TeX tal cual, que es lo que hay
      // escrito en el archivo: nada de huecos en blanco ni saltos de altura.
      wrap.textContent = this.tex;
      wrap.classList.add("is-loading");
      void cargarKatex().then((motor) => {
        // El hueco puede haberse quedado por el camino si CodeMirror rehízo la
        // decoración; escribir en un nodo suelto no molesta a nadie.
        if (!motor) return;
        wrap.classList.remove("is-loading");
        pintar(wrap, motor, this.tex, this.block);
      });
    }

    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Bloques `$$` … `$$`, cada delimitador en su propia línea. */
function blockMath(state: EditorState): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  const ranges = state.selection.ranges;

  for (let n = 1; n <= state.doc.lines; n++) {
    const open = state.doc.line(n);
    if (open.text.trim() !== "$$") continue;

    let close: number | null = null;
    for (let m = n + 1; m <= state.doc.lines; m++) {
      if (state.doc.line(m).text.trim() === "$$") {
        close = m;
        break;
      }
    }
    if (close === null) break;

    const end = state.doc.line(close);
    const inside = ranges.some((range) => range.from <= end.to && range.to >= open.from);
    if (!inside) {
      const tex = state.doc.sliceString(open.to + 1, end.from - 1);
      decorations.push(
        Decoration.replace({
          widget: new MathWidget(tex, true, open.from),
          block: true,
        }).range(open.from, end.to),
      );
    }
    n = close;
  }

  return decorations;
}

/**
 * Las fórmulas de bloque cambian la altura de la línea, así que son
 * decoraciones de bloque y CodeMirror sólo las admite desde un `StateField`,
 * igual que las tablas.
 */
export function mathBlocks(): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => Decoration.set(blockMath(state), true),
    update(value, transaction) {
      if (!transaction.docChanged && !transaction.selection) return value;
      return Decoration.set(blockMath(transaction.state), true);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
