import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { unfoldSearchPanel } from "../ui/searchPanel.ts";
import {
  insertLink,
  setHeading,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
} from "./commands.ts";
import { clickableLinks, type LinkHandlers } from "./links.ts";
import { assetResolver, livePreview } from "./livePreview.ts";
import { smartPaste, type PasteOptions } from "./paste.ts";
import { nextCell, nextRow, previousCell } from "./tables.ts";
import { unfoldTheme } from "./theme.ts";
import { typewriter, typewriterMode } from "./typewriter.ts";

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  /** Se llama en cada cambio del documento, para el autoguardado. */
  onChange: (doc: string) => void;
  /** Se llama al moverse el cursor, con la posición ya resuelta. */
  onSelection?: (line: number, column: number) => void;
  /** Traduce rutas de imagen del Markdown a URLs cargables por el WebView. */
  resolveAsset?: (src: string) => string;
  /** Qué hacer al pegar imágenes y HTML con formato. */
  paste: PasteOptions;
  /** Qué hacer al seguir un enlace con Ctrl+clic. */
  links: LinkHandlers;
}

const formattingKeymap = keymap.of([
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-e", run: toggleInlineCode },
  { key: "Mod-Shift-x", run: toggleStrikethrough },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-1", run: setHeading(1) },
  { key: "Mod-2", run: setHeading(2) },
  { key: "Mod-3", run: setHeading(3) },
  { key: "Mod-4", run: setHeading(4) },
  { key: "Mod-5", run: setHeading(5) },
  { key: "Mod-6", run: setHeading(6) },
  { key: "Mod-0", run: setHeading(0) },
]);

/**
 * Dentro de una tabla, Tab y Enter navegan entre celdas y filas. Fuera de ella
 * estos comandos devuelven false, así que el comportamiento normal del editor
 * (indentar, continuar la lista) sigue intacto.
 */
const tableKeymap = keymap.of([
  { key: "Tab", run: nextCell },
  { key: "Shift-Tab", run: previousCell },
  { key: "Enter", run: nextRow },
]);

/** El corrector del sistema: WebView2 ya lo trae, sólo hay que pedirlo. */
const nativeSpellcheck = EditorView.contentAttributes.of({
  spellcheck: "true",
  autocorrect: "off",
  autocapitalize: "off",
});

function baseExtensions(paste: PasteOptions, links: LinkHandlers): Extension {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    rectangularSelection(),
    highlightSpecialChars(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    search({ createPanel: unfoldSearchPanel, top: true }),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    nativeSpellcheck,
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      addKeymap: false,
    }),
    livePreview(),
    unfoldTheme(),
    smartPaste(paste),
    clickableLinks(links),
    typewriterMode.of([]),
    // El orden importa: las tablas capturan Tab y Enter antes que el resto.
    tableKeymap,
    formattingKeymap,
    keymap.of([
      { key: "Enter", run: insertNewlineContinueMarkup },
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
  ];
}

/**
 * Crea el estado de un documento.
 *
 * Se expone aparte de la vista porque cada pestaña guarda su propio estado
 * completo —texto, selección e historial— y cambiar de pestaña es sustituirlo
 * en la única vista que hay.
 */
export function createEditorState(doc: string, options: EditorOptions): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      baseExtensions(options.paste, options.links),
      assetResolver.of(options.resolveAsset ?? ((src) => src)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onChange(update.state.doc.toString());
        if ((update.selectionSet || update.docChanged) && options.onSelection) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          options.onSelection(line.number, head - line.from + 1);
        }
      }),
    ],
  });
}

export function createEditor(options: EditorOptions): EditorView {
  return new EditorView({
    parent: options.parent,
    state: createEditorState(options.doc, options),
  });
}

/** Sustituye el documento completo (abrir archivo). */
export function replaceDocument(view: EditorView, doc: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
    selection: { anchor: 0 },
    scrollIntoView: true,
  });
}

/** Enciende o apaga el modo máquina de escribir y devuelve el nuevo estado. */
export function setTypewriter(view: EditorView, active: boolean): void {
  view.dispatch({
    effects: typewriterMode.reconfigure(active ? typewriter() : []),
  });
}
