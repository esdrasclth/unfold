import type { ConnectedRepository, DocumentState, RepositoryDocument } from "../../repositories.ts";
import { isFolder } from "../../folders.ts";

export interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  documents: RepositoryDocument[];
}

export function nameOf(relative: string): string {
  return relative.split("/").pop() ?? relative;
}

export function folderOf(relative: string): string {
  const parts = relative.split("/");
  parts.pop();
  return parts.join("/");
}

function emptyFolder(name: string, path: string): Folder {
  return { name, path, folders: new Map(), documents: [] };
}

/** Agrupa las rutas planas del backend en el árbol que se enseña. */
export function buildTree(documents: readonly RepositoryDocument[]): Folder {
  const root = emptyFolder("", "");
  for (const document of documents) {
    const parts = document.relative.split("/");
    parts.pop();
    let current = root;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      let next = current.folders.get(part);
      if (!next) {
        next = emptyFolder(part, path);
        current.folders.set(part, next);
      }
      current = next;
    }
    current.documents.push(document);
  }
  return root;
}

/** Resumen de una línea: rama, cambios y distancia con el remoto. */
export function summaryOf(repository: ConnectedRepository): string {
  if (isFolder(repository)) {
    return repository.missing ? "La carpeta ya no está" : repository.path;
  }
  if (repository.missing) return "Sin copia local";

  const parts = [repository.branch ?? repository.defaultBranch];
  if (repository.changed > 0) parts.push(`${repository.changed} sin confirmar`);
  if (repository.ahead > 0) parts.push(`${repository.ahead} sin publicar`);
  if (repository.behind > 0) parts.push(`${repository.behind} sin traer`);

  if (parts.length === 1) {
    // Sin remoto conocido no se puede afirmar que esté sincronizado, sólo que
    // no hay nada pendiente por aquí.
    parts.push(repository.hasUpstream ? "sincronizado" : "sin remoto");
  }
  return parts.join(" · ");
}

export const STATE_LABEL: Record<DocumentState, string> = {
  synced: "",
  modified: "Con cambios sin confirmar",
  new: "Todavía no está en Git",
  conflicted: "Con un conflicto sin resolver",
};

/** Quita tildes y mayúsculas para que el filtro encuentre lo que se escribe. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Dos rutas son la misma aunque una traiga barras de Windows. */
export function samePath(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return left.replace(/\\/g, "/") === right.replace(/\\/g, "/");
}
