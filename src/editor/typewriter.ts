import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Permite encender y apagar el modo sin reconstruir el editor. */
export const typewriterMode = new Compartment();

/**
 * Mantiene la línea del cursor centrada verticalmente.
 *
 * Usa el efecto `scrollIntoView` de CodeMirror en lugar de tocar `scrollTop` a
 * mano: es quien conoce la fase de medida y el alto real de cada línea, así que
 * acierta también con tablas, imágenes y líneas partidas.
 *
 * El despacho se aplaza a un microtask porque no se puede despachar una
 * transacción desde dentro de `update`. La transacción resultante sólo lleva
 * efectos, sin cambios ni selección, así que no vuelve a dispararnos.
 */
const centerCaret = EditorView.updateListener.of((update) => {
  if (!update.selectionSet && !update.docChanged) return;

  const view = update.view;
  queueMicrotask(() => {
    const head = view.state.selection.main.head;
    view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: "center" }),
    });
  });
});

export function typewriter(): Extension {
  return [centerCaret];
}
