import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface Tab {
  id: number;
  path: string | null;
  name: string;
  dirty: boolean;
  /** Estado completo de CodeMirror: texto, selección e historial de deshacer. */
  state: EditorState;
  scrollTop: number;
}

/**
 * Documentos abiertos.
 *
 * Cada pestaña guarda un `EditorState` entero y no sólo su texto, de modo que
 * al volver a ella se recuperan también la selección y el historial de
 * deshacer. Se comparte una única vista: cambiar de pestaña es un `setState`,
 * mucho más barato que mantener un editor por documento.
 */
export class Tabs {
  private items: Tab[] = [];
  private activeId = 0;
  private nextId = 1;

  constructor(
    private readonly makeState: (doc: string) => EditorState,
    /** Se llama cuando cambia la lista o la pestaña activa. */
    private readonly onChange: () => void,
  ) {}

  list(): readonly Tab[] {
    return this.items;
  }

  active(): Tab {
    return this.items.find((tab) => tab.id === this.activeId) ?? this.items[0];
  }

  count(): number {
    return this.items.length;
  }

  dirtyTabs(): Tab[] {
    return this.items.filter((tab) => tab.dirty);
  }

  /** Guarda en la pestaña activa lo que hay ahora mismo en la vista. */
  private capture(view: EditorView): void {
    const current = this.active();
    if (!current) return;
    current.state = view.state;
    current.scrollTop = view.scrollDOM.scrollTop;
  }

  private show(view: EditorView, tab: Tab): void {
    view.setState(tab.state);
    // El scroll no vive en el estado, hay que reponerlo tras el cambio.
    view.requestMeasure({
      read: () => null,
      write: () => {
        view.scrollDOM.scrollTop = tab.scrollTop;
      },
    });
    this.activeId = tab.id;
    this.onChange();
  }

  /** Primera pestaña de la sesión, con el estado que ya tiene la vista. */
  adopt(state: EditorState, name: string): Tab {
    const tab: Tab = {
      id: this.nextId++,
      path: null,
      name,
      dirty: false,
      state,
      scrollTop: 0,
    };
    this.items.push(tab);
    this.activeId = tab.id;
    this.onChange();
    return tab;
  }

  /**
   * Abre un archivo. Si ya estaba abierto se activa el que había en lugar de
   * duplicarlo, que es lo que uno espera al volver a pulsar un enlace.
   */
  open(view: EditorView, path: string, name: string, content: string): Tab {
    const existing = this.items.find((tab) => tab.path === path);
    if (existing) {
      this.capture(view);
      this.show(view, existing);
      return existing;
    }

    this.capture(view);
    const tab: Tab = {
      id: this.nextId++,
      path,
      name,
      dirty: false,
      state: this.makeState(content),
      scrollTop: 0,
    };
    this.items.push(tab);
    this.show(view, tab);
    return tab;
  }

  create(view: EditorView): Tab {
    this.capture(view);
    const tab: Tab = {
      id: this.nextId++,
      path: null,
      name: "Sin título",
      dirty: false,
      state: this.makeState(""),
      scrollTop: 0,
    };
    this.items.push(tab);
    this.show(view, tab);
    return tab;
  }

  activate(view: EditorView, id: number): void {
    if (id === this.activeId) return;
    const target = this.items.find((tab) => tab.id === id);
    if (!target) return;
    this.capture(view);
    this.show(view, target);
  }

  /** Salta a la pestaña siguiente o anterior, dando la vuelta al llegar al final. */
  cycle(view: EditorView, step: number): void {
    if (this.items.length < 2) return;
    const index = this.items.findIndex((tab) => tab.id === this.activeId);
    const next = (index + step + this.items.length) % this.items.length;
    this.activate(view, this.items[next].id);
  }

  /**
   * Cierra una pestaña. Devuelve false si era la última, porque entonces no se
   * cierra: se vacía, y así la ventana nunca se queda sin editor.
   */
  close(view: EditorView, id: number): boolean {
    const index = this.items.findIndex((tab) => tab.id === id);
    if (index === -1) return false;

    if (this.items.length === 1) {
      const only = this.items[0];
      only.path = null;
      only.name = "Sin título";
      only.dirty = false;
      only.state = this.makeState("");
      only.scrollTop = 0;
      this.show(view, only);
      return false;
    }

    const wasActive = id === this.activeId;
    this.items.splice(index, 1);
    if (wasActive) {
      // Se pasa a la de la derecha, y si no la hay, a la de la izquierda.
      this.show(view, this.items[Math.min(index, this.items.length - 1)]);
    } else {
      this.onChange();
    }
    return true;
  }

  /** Trae al frente la pestaña indicada sin tocar la vista (para preguntar por ella). */
  focusFor(view: EditorView, tab: Tab): void {
    this.activate(view, tab.id);
  }

  touch(): void {
    this.onChange();
  }
}
