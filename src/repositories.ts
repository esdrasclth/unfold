/**
 * Repositorios conectados.
 *
 * El catálogo vive en disco, junto a los checkouts, y no depende de la sesión
 * de GitHub: estas llamadas funcionan sin red y sin token, que es lo que hace
 * que los repositorios sigan ahí al reiniciar.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./files.ts";

/** Qué pasó al traer los cambios del remoto. */
export type Advance = "upToDate" | "fastForwarded" | "dirty" | "diverged" | "noUpstream";

export interface ConnectedRepository {
  id: number;
  fullName: string;
  defaultBranch: string;
  cloneUrl: string;
  private: boolean;
  canPush: boolean;
  /** Carpeta del checkout. */
  path: string;
  lastUsed: number;
  /** Rama del checkout, que puede no ser la predeterminada. */
  branch: string | null;
  head: string | null;
  /** Archivos modificados o sin añadir. */
  changed: number;
  /** Commits locales sin publicar. */
  ahead: number;
  /** Commits del remoto sin traer. */
  behind: number;
  /** Falso mientras no se sepa nada del remoto. */
  hasUpstream: boolean;
  /** La carpeta ya no está o dejó de ser un repositorio. */
  missing: boolean;
}

export interface FetchReport {
  advance: Advance;
  repository: ConnectedRepository;
}

/** Cómo está un documento respecto a lo que Git tiene guardado. */
export type DocumentState = "synced" | "modified" | "new" | "conflicted";

export interface RepositoryDocument {
  /** Ruta absoluta: es la que abre el editor. */
  path: string;
  /** Ruta dentro del repositorio, para mostrarla. */
  relative: string;
  tracked: boolean;
  state: DocumentState;
}

/**
 * Un archivo que se aparta del último commit.
 *
 * Entra cualquier extensión, no sólo Markdown: una vista de cambios que
 * escondiera parte de lo pendiente sería peligrosa.
 */
export interface Change {
  relative: string;
  state: DocumentState;
  /** El archivo ya no está en el árbol de trabajo. */
  deleted: boolean;
  /** Ya estaba preparado en el índice antes de abrir la vista. */
  staged: boolean;
}

export type IdentitySource = "gitConfig" | "noreply";

export interface Identity {
  name: string;
  email: string;
  source: IdentitySource;
}

/** Qué pasó al publicar, paso por paso. */
export interface PublishReport {
  /** Identificador del commit creado, si se creó alguno. */
  commit: string | null;
  advance: Advance | null;
  pushed: boolean;
  /** Por qué se detuvo, si se detuvo. */
  problem: string | null;
  repository: ConnectedRepository;
}

export interface CloneProgress {
  id: number;
  received: number;
  total: number;
}

const CLONE_PROGRESS_EVENT = "github://clone-progress";

function requireDesktop(): void {
  if (!isTauri) throw new Error("Los repositorios requieren la aplicación de escritorio");
}

export async function connectedRepositories(): Promise<ConnectedRepository[]> {
  if (!isTauri) return [];
  return invoke<ConnectedRepository[]>("github_connected_repositories");
}

export async function connectRepository(id: number): Promise<ConnectedRepository> {
  requireDesktop();
  return invoke<ConnectedRepository>("github_connect_repository", { id });
}

export async function disconnectRepository(id: number, deleteCheckout: boolean): Promise<void> {
  requireDesktop();
  await invoke("github_disconnect_repository", { id, deleteCheckout });
}

export async function fetchRepository(id: number): Promise<FetchReport> {
  requireDesktop();
  return invoke<FetchReport>("github_fetch_repository", { id });
}

export async function repositoryDocuments(id: number): Promise<RepositoryDocument[]> {
  requireDesktop();
  return invoke<RepositoryDocument[]>("github_repository_documents", { id });
}

/** Valida físicamente la ruta y crea el documento dentro del checkout. */
export async function createRepositoryDocumentFile(id: number, target: string): Promise<string> {
  requireDesktop();
  return invoke<string>("github_create_repository_document", { id, target });
}

export async function repositoryChanges(id: number): Promise<Change[]> {
  requireDesktop();
  return invoke<Change[]>("github_repository_changes", { id });
}

/** Estado de un solo repositorio, para no releer todos ante cada cambio. */
export async function repositoryState(id: number): Promise<ConnectedRepository> {
  requireDesktop();
  return invoke<ConnectedRepository>("github_repository_state", { id });
}

export async function commitIdentity(forceNoreply: boolean): Promise<Identity> {
  requireDesktop();
  return invoke<Identity>("github_commit_identity", { forceNoreply });
}

export async function publish(
  id: number,
  paths: string[],
  message: string,
  forceNoreply: boolean,
): Promise<PublishReport> {
  requireDesktop();
  return invoke<PublishReport>("github_publish", { id, paths, message, forceNoreply });
}

/** Publica lo que ya esté confirmado, sin crear ningún commit. */
export async function pushPending(id: number): Promise<PublishReport> {
  requireDesktop();
  return invoke<PublishReport>("github_push_pending", { id });
}

/** Apunta el repositorio como recién usado, para ordenar la lista. */
export async function touchRepository(id: number): Promise<void> {
  if (!isTauri) return;
  await invoke("github_touch_repository", { id });
}

/**
 * Escucha el avance de un clone. Devuelve la función para dejar de escuchar,
 * que hay que llamar al cerrar el diálogo: si no, cada apertura deja un oyente
 * más sobre el mismo evento.
 */
export async function onCloneProgress(
  handle: (progress: CloneProgress) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<CloneProgress>(CLONE_PROGRESS_EVENT, (event) => handle(event.payload));
}

/** Frase para cada resultado de traer cambios, en el orden en que importan. */
export function advanceMessage(advance: Advance, fullName: string): string {
  switch (advance) {
    case "upToDate":
      return `«${fullName}» ya estaba al día`;
    case "fastForwarded":
      return `«${fullName}» se actualizó`;
    case "dirty":
      return `«${fullName}» tiene cambios sin confirmar: no se tocó nada`;
    case "diverged":
      return `«${fullName}» tiene commits que el remoto no tiene: hay que resolverlo con Git`;
    case "noUpstream":
      return `El remoto de «${fullName}» ya no publica esa rama`;
  }
}
