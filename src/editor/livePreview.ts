import { syntaxTree } from "@codemirror/language";
import {
  Facet,
  RangeSet,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { frontmatterRange } from "./frontmatter.ts";
import { inlineMath } from "./inlineMath.ts";
import { MathWidget, mathBlocks } from "./math.ts";
import { MermaidWidget } from "./mermaid.ts";
import { BulletWidget, ImageWidget, RuleWidget, TableWidget, TaskWidget } from "./widgets.ts";

/**
 * Resuelve la ruta de una imagen del Markdown a algo que el WebView pueda
 * cargar. En el navegador es la identidad; bajo Tauri se sustituye por
 * `convertFileSrc` para poder mostrar imágenes locales.
 */
export const assetResolver = Facet.define<(src: string) => string, (src: string) => string>({
  combine: (values) => values[0] ?? ((src: string) => src),
});

const hidden = Decoration.replace({});

/**
 * Sintaxis revelada bajo el cursor. No se muestra a pleno contraste: es
 * andamiaje para editar, no contenido, así que se atenúa para que el ojo la
 * ignore y la línea no "salte" visualmente al entrar en ella.
 */
const revealedMark = Decoration.mark({ class: "cm-md-revealed" });

const inlineMark = {
  emphasis: Decoration.mark({ class: "cm-md-em" }),
  strong: Decoration.mark({ class: "cm-md-strong" }),
  strike: Decoration.mark({ class: "cm-md-strike" }),
  code: Decoration.mark({ class: "cm-md-code" }),
  link: Decoration.mark({ class: "cm-md-link" }),
  fence: Decoration.mark({ class: "cm-md-fence" }),
  url: Decoration.mark({ class: "cm-md-url" }),
};

const headingLine = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-md-heading cm-md-h${level}` }),
);
const quoteLine = Decoration.line({ class: "cm-md-quote" });
const frontmatterLine = Decoration.line({ class: "cm-md-frontmatter" });
const codeLine = Decoration.line({ class: "cm-md-codeblock" });

/**
 * Construye las decoraciones para el trozo visible del documento.
 *
 * La idea es la de Typora: el buffer siempre contiene Markdown literal, pero
 * los marcadores de sintaxis se ocultan salvo cuando el cursor está dentro del
 * elemento, momento en el que reaparecen para poder editarlos.
 */
/**
 * Calcula las decoraciones de la parte visible.
 *
 * Toma el estado y los rangos, y no la vista, para poder ejercitarse sin
 * montar un editor: es el corazón del editor y merece pruebas que corran en un
 * par de segundos. La vista sólo aportaba estas dos cosas.
 */
export function buildDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
): {
  all: DecorationSet;
  atomic: DecorationSet;
} {
  const resolve = state.facet(assetResolver);
  const decorations: Range<Decoration>[] = [];
  const replacements: Range<Decoration>[] = [];
  const ranges = state.selection.ranges;

  /** Si la selección toca este rango, mostramos la sintaxis cruda. */
  const touches = (from: number, to: number): boolean => {
    for (const range of ranges) {
      if (range.from <= to && range.to >= from) return true;
    }
    return false;
  };

  /** Igual, pero a nivel de línea: los marcadores de bloque se revelan por línea. */
  const lineTouched = (pos: number): boolean => {
    const line = state.doc.lineAt(pos);
    return touches(line.from, line.to);
  };

  const conceal = (from: number, to: number): void => {
    if (to <= from) return;
    const range = hidden.range(from, to);
    decorations.push(range);
    replacements.push(range);
  };

  const replaceWith = (from: number, to: number, deco: Decoration): void => {
    const range = deco.range(from, to);
    decorations.push(range);
    replacements.push(range);
  };

  const decorateLines = (from: number, to: number, deco: Decoration): void => {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      decorations.push(deco.range(line.from));
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  };

  const frontmatter = frontmatterRange(state);
  if (frontmatter) {
    decorateLines(frontmatter.from, frontmatter.to, frontmatterLine);
  }

  for (const { from, to } of visibleRanges) {
    // Fórmulas en línea: se ocultan bajo el cursor como cualquier otra
    // sintaxis, para poder editarlas.
    for (const formula of inlineMath(state, from, to)) {
      if (touches(formula.from, formula.to)) continue;
      replaceWith(
        formula.from,
        formula.to,
        Decoration.replace({ widget: new MathWidget(formula.tex, false, formula.from) }),
      );
    }

    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        // Dentro del frontmatter no se aplica nada del análisis de Markdown:
        // ahí las rayas y los dos puntos son YAML, no sintaxis.
        if (frontmatter && node.from >= frontmatter.from && node.to <= frontmatter.to) {
          return false;
        }

        // --- Bloques -----------------------------------------------------
        if (name.startsWith("ATXHeading")) {
          const level = Number(name.slice(-1));
          decorations.push(headingLine[level - 1].range(state.doc.lineAt(node.from).from));
          return;
        }

        if (name === "HeaderMark") {
          const parent = node.node.parent;
          // En un heading setext el HeaderMark es el subrayado `===`: lo
          // atenuamos en vez de ocultarlo, porque vaciar la línea entera
          // dejaría un hueco entre el título y el texto siguiente.
          if (parent?.name.startsWith("Setext")) {
            decorations.push(inlineMark.fence.range(node.from, node.to));
            return;
          }
          if (!lineTouched(node.from)) {
            // Nos comemos también el espacio que separa la almohadilla del texto.
            const after = state.doc.sliceString(node.to, node.to + 1);
            conceal(node.from, after === " " ? node.to + 1 : node.to);
          } else {
            decorations.push(revealedMark.range(node.from, node.to));
          }
          return;
        }

        if (name === "Blockquote") {
          decorateLines(node.from, node.to, quoteLine);
          return;
        }

        if (name === "QuoteMark") {
          if (!lineTouched(node.from)) {
            const after = state.doc.sliceString(node.to, node.to + 1);
            conceal(node.from, after === " " ? node.to + 1 : node.to);
          } else {
            decorations.push(revealedMark.range(node.from, node.to));
          }
          return;
        }

        if (name === "FencedCode" || name === "CodeBlock") {
          decorateLines(node.from, node.to, codeLine);
          return;
        }

        if (name === "HorizontalRule") {
          if (!lineTouched(node.from)) {
            replaceWith(node.from, node.to, Decoration.replace({ widget: new RuleWidget() }));
          }
          return;
        }

        if (name === "ListMark") {
          const marker = state.doc.sliceString(node.from, node.to);
          const ordered = /\d/.test(marker);
          if (!ordered && !lineTouched(node.from)) {
            replaceWith(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
          }
          return;
        }

        if (name === "TaskMarker") {
          const checked = /[xX]/.test(state.doc.sliceString(node.from, node.to));
          replaceWith(
            node.from,
            node.to,
            Decoration.replace({ widget: new TaskWidget(checked, node.from, node.to) }),
          );
          return;
        }

        // --- Elementos en línea ------------------------------------------
        if (name === "Emphasis") {
          decorations.push(inlineMark.emphasis.range(node.from, node.to));
          return;
        }

        if (name === "StrongEmphasis") {
          decorations.push(inlineMark.strong.range(node.from, node.to));
          return;
        }

        if (name === "Strikethrough") {
          decorations.push(inlineMark.strike.range(node.from, node.to));
          return;
        }

        if (name === "InlineCode") {
          decorations.push(inlineMark.code.range(node.from, node.to));
          return;
        }

        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          const parent = node.node.parent;
          if (parent && !touches(parent.from, parent.to)) {
            conceal(node.from, node.to);
          } else {
            decorations.push(revealedMark.range(node.from, node.to));
          }
          return;
        }

        if (name === "CodeMark") {
          const parent = node.node.parent;
          if (parent?.name === "FencedCode") {
            // Las vallas del bloque se atenúan y hacen de cromo del contenedor.
            decorations.push(inlineMark.fence.range(node.from, node.to));
          } else if (parent && !touches(parent.from, parent.to)) {
            conceal(node.from, node.to);
          } else {
            decorations.push(revealedMark.range(node.from, node.to));
          }
          return;
        }

        if (name === "CodeInfo") {
          decorations.push(inlineMark.fence.range(node.from, node.to));
          return;
        }

        if (name === "Image") {
          if (touches(node.from, node.to)) return;
          const raw = state.doc.sliceString(node.from, node.to);
          const match = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(raw);
          if (!match) return;
          replaceWith(
            node.from,
            node.to,
            Decoration.replace({ widget: new ImageWidget(resolve(match[2]), match[1]) }),
          );
          return;
        }

        if (name === "Link") {
          decorations.push(inlineMark.link.range(node.from, node.to));
          return;
        }

        if (name === "LinkMark" || name === "URL" || name === "LinkTitle") {
          const parent = node.node.parent;
          if (parent?.name === "Image") return; // ya sustituido por el widget
          if (parent && !touches(parent.from, parent.to)) {
            conceal(node.from, node.to);
          } else if (name === "URL") {
            decorations.push(inlineMark.url.range(node.from, node.to));
          } else {
            decorations.push(revealedMark.range(node.from, node.to));
          }
          return;
        }
      },
    });
  }

  return {
    all: Decoration.set(decorations, true),
    atomic: Decoration.set(replacements, true),
  };
}

/**
 * Las tablas se sustituyen por una tabla HTML real, y eso es una decoración de
 * bloque: cambia la altura de las líneas. CodeMirror sólo las acepta desde un
 * `StateField`, nunca desde un `ViewPlugin`, porque necesita conocerlas antes
 * de calcular la disposición vertical.
 *
 * Para que siga siendo barato recorremos únicamente los bloques de primer
 * nivel del árbol en vez de todo el documento.
 */
function buildTables(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Table") continue;

    // Con el cursor dentro mostramos los pipes tal cual, para poder editarlos.
    let editing = false;
    for (const range of state.selection.ranges) {
      if (range.from <= node.to && range.to >= node.from) {
        editing = true;
        break;
      }
    }
    if (editing) continue;

    const first = state.doc.lineAt(node.from);
    const last = state.doc.lineAt(node.to);
    decorations.push(
      Decoration.replace({
        widget: new TableWidget(state.doc.sliceString(first.from, last.to), first.from),
        block: true,
      }).range(first.from, last.to),
    );
  }

  return Decoration.set(decorations, true);
}

function buildMermaid(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "FencedCode") continue;
    const info = node.getChild("CodeInfo");
    if (!info || state.doc.sliceString(info.from, info.to).trim().toLowerCase() !== "mermaid") continue;
    if (state.selection.ranges.some((range) => range.from <= node.to && range.to >= node.from)) continue;
    const textNode = node.getChild("CodeText");
    const source = textNode ? state.doc.sliceString(textNode.from, textNode.to).replace(/\n$/, "") : "";
    decorations.push(Decoration.replace({ widget: new MermaidWidget(source), block: true }).range(node.from, node.to));
  }
  return Decoration.set(decorations, true);
}

const tableField = StateField.define<DecorationSet>({
  create: (state) => buildTables(state),
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    return buildTables(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const mermaidField = StateField.define<DecorationSet>({
  create: (state) => buildMermaid(state),
  update(value, transaction) {
    if (!transaction.docChanged && !transaction.selection) return value;
    return buildMermaid(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      const built = buildDecorations(view.state, view.visibleRanges);
      this.decorations = built.all;
      this.atomic = built.atomic;
    }

    update(update: ViewUpdate): void {
      // Sólo hace falta recalcular si cambia el texto, lo que se ve, o dónde
      // está el cursor: las tres cosas que deciden qué sintaxis se revela.
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        const built = buildDecorations(update.view.state, update.view.visibleRanges);
        this.decorations = built.all;
        this.atomic = built.atomic;
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? RangeSet.empty),
  },
);

export function livePreview(): Extension {
  return [tableField, mermaidField, mathBlocks(), livePreviewPlugin];
}
