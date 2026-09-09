/**
 * Carpetas locales abiertas en el explorador.
 *
 * El árbol estaba atado a GitHub, y quien no lo usa no tenía explorador. Una
 * carpeta es la misma idea sin Git: una raíz con documentos dentro. Se adapta
 * a la forma de un repositorio para que el panel las pinte igual, porque el
 * árbol, la búsqueda por nombre y el plegado ya estaban hechos y probados.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./files.ts";
import type {
  ConnectedRepository,
  CreatedDocument,
  RepositoryDocument,
} from "./repositories.ts";

export interface Folder {
  /** Negativo siempre: es lo que distingue una carpeta de un repositorio. */
  id: number;
  path: string;
  name: string;
  missing: boolean;
}

export interface FolderDocument {
  path: string;
  relative: string;
}

/** Una raíz del panel es una carpeta si su identificador es negativo. */
export function isFolder(root: { id: number }): boolean {
  return root.id < 0;
}

/**
 * Da a una carpeta la forma de un repositorio.
 *
 * Los campos de Git van vacíos y `canPush` en falso, que es lo que hace que el
 * panel no ofrezca publicar: no hay nada a donde publicar.
 */
export function asRoot(folder: Folder): ConnectedRepository {
  return {
    id: folder.id,
    fullName: folder.name,
    defaultBranch: "",
    cloneUrl: "",
    private: false,
    canPush: false,
    path: folder.path,
    lastUsed: 0,
    branch: null,
    head: null,
    changed: 0,
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    missing: folder.missing,
  };
}

/** Y a sus documentos, la de los de un repositorio: sin estado de Git. */
export function asDocument(document: FolderDocument): RepositoryDocument {
  return { ...document, tracked: false, state: "synced" };
}

export async function openFolders(): Promise<Folder[]> {
  if (!isTauri) return [];
  return invoke<Folder[]>("open_folders");
}

export async function openFolder(path: string): Promise<Folder> {
  return invoke<Folder>("open_folder", { path });
}

export async function closeFolder(id: number): Promise<void> {
  await invoke("close_folder", { id });
}

export async function folderCreateDocument(id: number, target: string): Promise<CreatedDocument> {
  return invoke<CreatedDocument>("folder_create_document", { id, target });
}

export async function folderDocuments(id: number): Promise<FolderDocument[]> {
  return invoke<FolderDocument[]>("folder_documents", { id });
}

/** Pide una carpeta al sistema. Devuelve null si se cancela el diálogo. */
export async function chooseFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const elegida = await open({ directory: true, multiple: false });
  return typeof elegida === "string" ? elegida : null;
}
