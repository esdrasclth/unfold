import { WidgetType } from "@codemirror/view";

const cache = new Map<string, string>();

export class MermaidWidget extends WidgetType {
  constructor(private readonly source: string) { super(); }
  eq(other: MermaidWidget): boolean { return other.source === this.source; }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-mermaid";
    wrap.textContent = "Generando diagrama…";
    const cached = cache.get(this.source);
    if (cached) { wrap.innerHTML = cached; return wrap; }
    void import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
      return mermaid.render(`unfold-mermaid-${Math.random().toString(36).slice(2)}`, this.source);
    }).then(({ svg }) => { if (cache.size >= 100) cache.delete(cache.keys().next().value as string); cache.set(this.source, svg); wrap.innerHTML = svg; }).catch(() => {
      wrap.classList.add("is-error");
      wrap.textContent = "No se pudo renderizar Mermaid. Revisa la sintaxis en modo fuente.";
    });
    return wrap;
  }
  ignoreEvent(): boolean { return false; }
}
