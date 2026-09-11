import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  createEditor,
  createEditorState,
  replaceDocument,
  type EditorOptions,
} from "./index.ts";

/** Opciones de CodeMirror que no dependen del nodo donde se monta. */
export type EditorControllerOptions = Omit<EditorOptions, "parent" | "doc">;

/**
 * Adaptador de ciclo de vida para CodeMirror.
 *
 * El controlador conserva la vista y sus estados completos; Preact sólo le
 * entrega el hueco inicial y recibe los callbacks derivados que ya exponía el
 * editor. Así escribir nunca convierte el documento en estado reactivo.
 */
export class EditorController {
  private view: EditorView | null = null;

  constructor(private readonly options: EditorControllerOptions) {}

  createState(doc: string): EditorState {
    return createEditorState(doc, { ...this.options, doc });
  }

  mount(parent: HTMLElement, doc: string): EditorView {
    if (this.view) throw new Error("EditorController ya está montado");
    this.view = createEditor({ ...this.options, parent, doc });
    return this.view;
  }

  replaceDocument(doc: string): void {
    if (this.view) replaceDocument(this.view, doc);
  }

  current(): EditorView | null {
    return this.view;
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}
