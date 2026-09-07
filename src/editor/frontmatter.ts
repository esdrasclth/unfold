import type { EditorState } from "@codemirror/state";

/**
 * Bloque de metadatos YAML al principio del documento.
 *
 * Hay que reconocerlo aparte porque para Markdown no existe: la primera línea
 * `---` es una regla horizontal, y la de cierre convierte lo de en medio en un
 * encabezado subrayado. Sin esto, el frontmatter se ve como un título enorme
 * entre dos rayas, y además ese falso título se cuela en el esquema.
 *
 * Vive en su propio módulo porque lo necesitan tanto la vista previa como la
 * extracción de encabezados, y las dos tienen que coincidir.
 */
export function frontmatterRange(state: EditorState): { from: number; to: number } | null {
  if (state.doc.lines < 2) return null;
  const first = state.doc.line(1);
  if (first.text.trim() !== "---") return null;

  // Un bloque sin cierre no es frontmatter; se acota la búsqueda para no
  // recorrer un documento entero por una raya suelta en la primera línea.
  const limit = Math.min(state.doc.lines, 200);
  for (let n = 2; n <= limit; n++) {
    const line = state.doc.line(n);
    const text = line.text.trim();
    if (text === "---" || text === "...") return { from: first.from, to: line.to };
  }
  return null;
}
