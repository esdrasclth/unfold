import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { frontmatterRange } from "./frontmatter.ts";

export interface Heading {
  level: number;
  text: string;
  /** Inicio de la línea del encabezado en el documento. */
  from: number;
}

/**
 * Extrae los encabezados del documento a partir del árbol sintáctico.
 *
 * Va por el árbol y no por expresiones regulares para que una almohadilla
 * dentro de un bloque de código o de un comentario no aparezca en el esquema.
 */
export function headingsOf(state: EditorState): Heading[] {
  const headings: Heading[] = [];
  const tree = syntaxTree(state);
  // El cierre del frontmatter convierte su última clave en un encabezado
  // subrayado a ojos de Markdown; ese falso título no debe salir en el esquema.
  const frontmatter = frontmatterRange(state);

  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const atx = node.name.startsWith("ATXHeading");
    const setext = node.name.startsWith("SetextHeading");
    if (!atx && !setext) continue;
    if (frontmatter && node.from >= frontmatter.from && node.to <= frontmatter.to + 1) continue;

    const raw = state.doc.sliceString(node.from, node.to);
    const text = atx
      ? raw.replace(/^#{1,6}\s*/, "").replace(/\s*#*\s*$/, "")
      : raw.split("\n")[0].trim();

    headings.push({
      level: Number(node.name.slice(-1)),
      text: text.trim(),
      from: state.doc.lineAt(node.from).from,
    });
  }

  return headings;
}

/** Índice del encabezado que contiene la posición dada, o -1. */
export function activeHeading(headings: Heading[], pos: number): number {
  let active = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].from <= pos) active = i;
    else break;
  }
  return active;
}
