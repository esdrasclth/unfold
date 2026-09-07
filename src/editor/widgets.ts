import { EditorView, WidgetType } from "@codemirror/view";
import { parseTableSource } from "./tables.ts";

/** Viñeta redonda que sustituye al `-`, `*` o `+` de una lista. */
export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    return span;
  }
}

/** Línea horizontal real en lugar de `---`. */
export class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-rule";
    wrap.appendChild(document.createElement("hr"));
    return wrap;
  }
}

/**
 * Casilla de una lista de tareas. Al pulsarla reescribe el marcador en el
 * documento, de forma que el archivo sigue siendo la única fuente de verdad.
 */
export class TaskWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: this.checked ? "[ ]" : "[x]",
        },
      });
      view.focus();
    });
    return box;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Imagen renderizada en línea, con hueco reservado para evitar saltos de scroll. */
export class ImageWidget extends WidgetType {
  constructor(
    private readonly url: string,
    private readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-image";
    const img = document.createElement("img");
    img.src = this.url;
    img.alt = this.alt;
    img.loading = "lazy";
    img.addEventListener("error", () => wrap.classList.add("is-broken"));
    wrap.appendChild(img);
    return wrap;
  }
}

type Align = "left" | "center" | "right";

/**
 * Tabla renderizada de verdad. Sustituye al bloque de barras mientras el cursor
 * está fuera; al pulsar una celda, el cursor aterriza en esa misma celda del
 * Markdown y la tabla vuelve a mostrarse como texto para editarla.
 */
export class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly from: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";

    // El mismo modelo que usa la navegación con tabulador, así el clic y el
    // teclado no pueden discrepar sobre dónde empieza cada celda.
    const model = parseTableSource(this.source, this.from);
    const body = model.rows.filter((row) => !row.delimiter);
    if (body.length === 0) return wrap;

    const text = (cell: { from: number; to: number }): string =>
      this.source.slice(cell.from - this.from, cell.to - this.from);

    const delimiter = model.rows.find((row) => row.delimiter);
    const aligns: Align[] = (delimiter?.cells ?? []).map((cell) => {
      const spec = text(cell).trim();
      const left = spec.startsWith(":");
      const right = spec.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      return "left";
    });

    const build = (
      row: { cells: { from: number; to: number }[] },
      tag: "th" | "td",
    ): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      for (const [index, cell] of row.cells.entries()) {
        const el = document.createElement(tag);
        renderInline(text(cell).trim(), el);
        el.style.textAlign = aligns[index] ?? "left";
        // Guardamos dónde empieza la celda en el documento real.
        el.dataset.from = String(cell.from);
        el.dataset.to = String(cell.to);
        tr.appendChild(el);
      }
      return tr;
    };

    const table = document.createElement("table");
    const head = document.createElement("thead");
    head.appendChild(build(body[0], "th"));
    table.appendChild(head);

    const tbody = document.createElement("tbody");
    for (const row of body.slice(1)) tbody.appendChild(build(row, "td"));
    table.appendChild(tbody);
    wrap.appendChild(table);

    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>("th, td");
      const from = cell?.dataset.from;
      const to = cell?.dataset.to;
      // Al pulsar una celda seleccionamos su contenido; fuera, vamos al inicio.
      view.dispatch({
        selection:
          from && to
            ? { anchor: Number(from), head: Number(to) }
            : { anchor: this.from },
        scrollIntoView: true,
      });
      view.focus();
    });

    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Renderiza Markdown en línea dentro de una celda de tabla.
 *
 * Construye nodos DOM uno a uno en lugar de asignar innerHTML: el texto viene
 * del documento del usuario y nunca debe interpretarse como HTML.
 */
export function renderInline(text: string, into: HTMLElement): void {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*)|(\[[^\]]*\]\([^)]*\))/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) into.appendChild(document.createTextNode(text.slice(last, index)));

    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      into.appendChild(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      into.appendChild(strong);
    } else if (token.startsWith("~~")) {
      const del = document.createElement("del");
      del.textContent = token.slice(2, -2);
      into.appendChild(del);
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const anchor = document.createElement("a");
      anchor.textContent = token.slice(1, split);
      anchor.href = token.slice(split + 2, -1);
      anchor.rel = "noreferrer";
      into.appendChild(anchor);
    } else {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      into.appendChild(em);
    }
    last = index + token.length;
  }

  if (last < text.length) into.appendChild(document.createTextNode(text.slice(last)));
}
