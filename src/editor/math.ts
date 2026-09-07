import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";
import "katex/dist/katex.min.css";

/** Fórmula renderizada. Sustituye al TeX mientras el cursor está fuera. */
export class MathWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly block: boolean,
    /** Posición a la que llevar el cursor al pulsarla. */
    private readonly from: number,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.block === this.block && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement(this.block ? "div" : "span");
    wrap.className = this.block ? "cm-md-math is-block" : "cm-md-math";

    try {
      // `throwOnError: false` deja el error dentro de la fórmula en vez de
      // romper el render: escribiendo TeX se pasa por muchos estados inválidos.
      wrap.innerHTML = katex.renderToString(this.tex, {
        displayMode: this.block,
        throwOnError: false,
        output: "html",
        strict: false,
      });
    } catch {
      wrap.textContent = this.tex;
      wrap.classList.add("is-broken");
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
