import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

/**
 * Estructura del editor. Los colores concretos viven en CSS como variables,
 * para que el cambio de tema claro/oscuro sea un único atributo en <html> y no
 * obligue a reconstruir extensiones de CodeMirror.
 */
const structure = EditorView.theme({
  "&": {
    color: "var(--text-body)",
    backgroundColor: "transparent",
    fontSize: "var(--editor-font-size)",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-body)",
    lineHeight: "var(--editor-line-height)",
    overflowY: "auto",
    padding: "var(--editor-padding-block) 0",
  },
  ".cm-content": {
    maxWidth: "var(--editor-measure)",
    margin: "0 auto",
    width: "100%",
    padding: "0 var(--editor-padding-inline)",
    caretColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 4px" },

  // --- Cursor -------------------------------------------------------------
  // El cursor se desliza hasta su nueva posición en lugar de teletransportarse.
  // 90 ms es suficiente para que el ojo perciba continuidad y lo bastante corto
  // para que no se quede atrás al escribir rápido.
  ".cm-cursor, .cm-dropCursor": {
    borderLeftWidth: "2px",
    borderLeftColor: "var(--caret)",
    borderRadius: "1px",
    transition: "left 90ms var(--ease), top 90ms var(--ease)",
  },
  // El parpadeo por pasos de CodeMirror es un encendido y apagado seco.
  ".cm-cursorLayer": {
    animation: "unfold-blink 1.2s ease-in-out infinite !important",
  },

  // --- Selección ----------------------------------------------------------
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-selectionBackground": { borderRadius: "3px" },

  ".cm-activeLine": {
    backgroundColor: "var(--line-active)",
    borderRadius: "6px",
    transition: "background-color 220ms var(--ease)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--selection-match)",
    borderRadius: "3px",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--search-match)",
    borderRadius: "3px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--search-match-active)",
  },
  ".cm-panels": { backgroundColor: "transparent", color: "var(--text-body)", border: "none" },
  ".cm-panel input, .cm-panel button": { fontFamily: "var(--font-ui)", fontSize: "13px" },
});

/** Resaltado de sintaxis dentro de los bloques de código. */
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syn-keyword)" },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: "var(--syn-keyword)" },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: "var(--syn-name)" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "var(--syn-function)" },
  { tag: [tags.propertyName], color: "var(--syn-property)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syn-type)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syn-number)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syn-string)" },
  { tag: [tags.comment, tags.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--syn-punct)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

export function unfoldTheme(): Extension {
  return [structure, highlightActiveLine(), syntaxHighlighting(codeHighlight)];
}
