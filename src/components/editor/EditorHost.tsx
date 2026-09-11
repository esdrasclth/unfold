import { useLayoutEffect, useRef } from "preact/hooks";
import type { EditorView } from "@codemirror/view";
import { EditorController } from "../../editor/EditorController.ts";

export interface EditorHostProps {
  controller: EditorController;
  /** Documento inicial; los siguientes cambios llegan por EditorState. */
  doc: string;
  onReady?: (view: EditorView) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Hueco Preact para una vista de CodeMirror.
 *
 * El efecto se monta una sola vez: cambiar de pestaña sustituye el
 * `EditorState` dentro del controlador, no desmonta ni recrea este nodo.
 */
export function EditorHost({ controller, doc, onReady, onFocus, onBlur }: EditorHostProps) {
  const host = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const enfocar = () => onFocus?.();
    const desenfocar = () => onBlur?.();
    parent.addEventListener("focusin", enfocar);
    parent.addEventListener("focusout", desenfocar);
    const view = controller.mount(parent, doc);
    onReady?.(view);

    return () => {
      parent.removeEventListener("focusin", enfocar);
      parent.removeEventListener("focusout", desenfocar);
      controller.destroy();
    };
  }, [controller]);

  return <div class="editor-mount" ref={host} />;
}
