import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { headingsOf } from "./headings.ts";
import { slugify } from "../export/markdownToHtml.ts";

export interface LinkHandlers {
  /** Abre otro documento Markdown enlazado desde éste. */
  openDocument: (path: string) => void;
  /** Ruta del documento actual, para resolver enlaces relativos. */
  documentPath: () => string | null;
  notify: (message: string) => void;
}

/** Destino de un enlace en la posición dada, si lo hay. */
function urlAt(view: EditorView, pos: number): string | null {
  let node = syntaxTree(view.state).resolveInner(pos, -1);
  while (node.parent) {
    if (node.name === "Link" || node.name === "Autolink") break;
    node = node.parent;
  }
  if (node.name === "Autolink") {
    return view.state.doc.sliceString(node.from, node.to).replace(/^<|>$/g, "");
  }
  if (node.name !== "Link") return null;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "URL") return view.state.doc.sliceString(child.from, child.to);
  }
  return null;
}

function directoryOf(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

/** Lleva el cursor al encabezado cuyo identificador coincide con el ancla. */
function jumpToAnchor(view: EditorView, anchor: string): boolean {
  const target = anchor.replace(/^#/, "").toLowerCase();
  const heading = headingsOf(view.state).find((item) => slugify(item.text) === target);
  if (!heading) return false;

  view.dispatch({
    selection: EditorSelection.cursor(heading.from),
    effects: EditorView.scrollIntoView(heading.from, { y: "start", yMargin: 40 }),
  });
  view.focus();
  return true;
}

function follow(view: EditorView, url: string, handlers: LinkHandlers): void {
  // 1. Ancla dentro del propio documento.
  if (url.startsWith("#")) {
    if (!jumpToAnchor(view, url)) handlers.notify("No hay ningún encabezado con ese nombre");
    return;
  }

  // 2. Otro Markdown del disco: se abre aquí, no en el navegador.
  if (/\.(md|markdown|mdx|txt)$/i.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    const base = handlers.documentPath();
    if (!base) {
      handlers.notify("Guarda el documento para poder seguir enlaces relativos");
      return;
    }
    const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(url) ? url : `${directoryOf(base)}/${url}`;
    handlers.openDocument(decodeURI(absolute));
    return;
  }

  // 3. Todo lo demás va al navegador del sistema, y sólo si es http o mailto:
  // abrir cualquier esquema desde un documento ajeno sería una vía de entrada.
  if (!/^(https?|mailto):/i.test(url)) {
    handlers.notify("Sólo se abren enlaces http, https y mailto");
    return;
  }

  void import("@tauri-apps/plugin-opener")
    .then((opener) => opener.openUrl(url))
    .catch((error: unknown) => {
      // Se registra el motivo: el aviso se borra solo a los pocos segundos y
      // sin esto un fallo de permisos es indistinguible de uno de red.
      console.error("No se pudo abrir el enlace", url, error);
      handlers.notify("No se pudo abrir el enlace");
    });
}

/**
 * Enlaces que se pueden seguir con Ctrl+clic.
 *
 * Con clic normal no: la dirección está oculta por la vista previa, así que un
 * clic simple tiene que seguir sirviendo para colocar el cursor y revelar el
 * Markdown. Mientras se mantiene Ctrl, el puntero cambia a mano sobre los
 * enlaces para que se vea que ahí sí se puede pulsar.
 */
export function clickableLinks(handlers: LinkHandlers): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.ctrlKey && !event.metaKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const url = urlAt(view, pos);
      if (!url) return false;

      event.preventDefault();
      follow(view, url, handlers);
      return true;
    },
  });
}
