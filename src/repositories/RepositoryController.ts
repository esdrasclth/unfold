import {
  asDocument,
  asRoot,
  folderDocuments,
  isFolder,
  openFolders,
} from "../folders.ts";
import {
  connectedRepositories,
  repositoryDocuments,
  repositoryState,
  type ConnectedRepository,
  type RepositoryDocument,
} from "../repositories.ts";

export type RepositoryWatch = (typeof import("@tauri-apps/plugin-fs"))["watch"];

export interface RepositoryControllerOptions {
  /** Inyectable para las pruebas; sin ella se carga el plugin de Tauri. */
  watch?: RepositoryWatch;
  /** Apagable para las pruebas que no quieren vigilancia. */
  watchRepositories?: boolean;
}

/** Lo que el explorador enseña. Nada de esto es del DOM. */
export interface RepositoryData {
  repositories: ConnectedRepository[];
  documents: Map<number, RepositoryDocument[]>;
  loading: boolean;
  problem: string | null;
  /** Repositorios de GitHub, sin contar las carpetas locales. */
  connectedCount: number;
}

/**
 * Los datos del explorador y la vigilancia del disco.
 *
 * Aparte de la vista a propósito. Aquí viven las llamadas al backend, los
 * temporizadores y las vigilancias recursivas; el panel se suscribe a lo que
 * salga y no va a buscarlo. Plegar una carpeta o escribir en el filtro no pasa
 * por aquí, que es lo que garantiza que no vuelvan a consultar el backend: no
 * tienen forma de hacerlo.
 *
 * Las respuestas viejas no pisan a las nuevas. Hay dos contadores porque hay
 * dos alcances: uno global para releer el catálogo entero, y uno por
 * repositorio para cuando sólo cambia uno. Cada respuesta comprueba el suyo
 * antes de escribir, así que una lectura lenta que llega tarde se descarta.
 */
export class RepositoryController {
  private repositories: ConnectedRepository[] = [];
  private documents = new Map<number, RepositoryDocument[]>();
  private loading = false;
  private problem: string | null = null;
  private connectedCount = 0;

  private generation = 0;
  private readonly repositoryGenerations = new Map<number, number>();

  private readonly watchStops = new Map<number, () => void>();
  private readonly watchStarting = new Set<number>();
  private readonly watchedPaths = new Map<number, string>();
  private readonly watchTimers = new Map<number, number>();
  private disposed = false;

  private readonly options: RepositoryControllerOptions;
  private readonly listeners = new Set<(data: RepositoryData) => void>();

  constructor(options: RepositoryControllerOptions = {}) {
    this.options = options;
  }

  subscribe(listener: (data: RepositoryData) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): RepositoryData {
    return {
      repositories: this.repositories,
      documents: this.documents,
      loading: this.loading,
      problem: this.problem,
      connectedCount: this.connectedCount,
    };
  }

  private emit(): void {
    const data = this.snapshot();
    for (const listener of this.listeners) listener(data);
  }

  /**
   * Relee el catálogo y los documentos de cada repositorio.
   *
   * Se piden todos y no sólo los desplegados porque la búsqueda cruza los
   * repositorios: filtrar sólo lo que está abierto escondería resultados sin
   * ninguna razón visible.
   */
  async refresh(forceDocuments = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.loading = true;
    this.problem = null;
    this.emit();

    try {
      /*
       * Dos catálogos, una sola lista. Las carpetas van primero porque son del
       * disco de aquí: se abren y se cierran en el acto, mientras que un
       * repositorio arrastra una copia y una sesión detrás.
       */
      const [conectados, carpetas] = await Promise.all([
        connectedRepositories(),
        openFolders().catch(() => []),
      ]);
      if (generation !== this.generation) return;
      conectados.sort((left, right) => left.fullName.localeCompare(right.fullName));
      const repositories = [...carpetas.map(asRoot), ...conectados];
      this.repositories = repositories;
      this.connectedCount = conectados.length;
      for (const repository of repositories) {
        this.repositoryGenerations.set(
          repository.id,
          (this.repositoryGenerations.get(repository.id) ?? 0) + 1,
        );
      }

      const known = new Set(repositories.map((repository) => repository.id));
      for (const id of this.documents.keys()) if (!known.has(id)) this.documents.delete(id);

      const loaded = await Promise.all(
        repositories.map(async (repository) => {
          if (repository.missing) return [repository.id, [] as RepositoryDocument[]] as const;
          if (!forceDocuments && this.documents.has(repository.id)) {
            return [repository.id, this.documents.get(repository.id)!] as const;
          }
          try {
            const documentos = isFolder(repository)
              ? (await folderDocuments(repository.id)).map(asDocument)
              : await repositoryDocuments(repository.id);
            return [repository.id, documentos] as const;
          } catch {
            // Un repositorio ilegible no puede dejar sin explorador a los
            // demás: se queda vacío y su resumen ya dice que algo pasa.
            return [repository.id, [] as RepositoryDocument[]] as const;
          }
        }),
      );
      if (generation !== this.generation) return;
      this.documents = new Map(loaded);
      void this.syncWatchers();
    } catch (error) {
      if (generation !== this.generation) return;
      this.repositories = [];
      this.documents.clear();
      // La copia no sobra: `stopWatcher` borra del mapa, y recorrer el
      // iterador vivo mientras se borra se salta entradas.
      // oxlint-disable-next-line no-useless-spread
      for (const id of [...this.watchStops.keys()]) this.stopWatcher(id);
      this.problem = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.emit();
      }
    }
  }

  /** Actualiza sólo el repositorio que contiene la ruta indicada. */
  async refreshPath(path: string | null): Promise<void> {
    const repository = this.repositoryOf(path);
    if (repository) await this.refreshRepository(repository.id, true);
  }

  /** Relee estado y, si cambió el disco, el árbol de un único repositorio. */
  async refreshRepository(id: number, documentsChanged = false): Promise<void> {
    if (this.disposed || !this.repositories.some((repository) => repository.id === id)) return;
    const generation = (this.repositoryGenerations.get(id) ?? 0) + 1;
    this.repositoryGenerations.set(id, generation);
    try {
      // Una carpeta no tiene estado que consultar: lo único que cambia de ella
      // es lo que hay dentro, así que se relee el árbol y ya.
      if (isFolder({ id })) {
        const documentos = (await folderDocuments(id)).map(asDocument);
        if (this.disposed || this.repositoryGenerations.get(id) !== generation) return;
        this.documents = new Map(this.documents).set(id, documentos);
        this.problem = null;
        this.emit();
        return;
      }
      const repository = await repositoryState(id);
      if (this.disposed || this.repositoryGenerations.get(id) !== generation) return;
      let documents: RepositoryDocument[] | null = null;
      if (documentsChanged && !repository.missing) {
        documents = await repositoryDocuments(id);
      }
      if (this.disposed || this.repositoryGenerations.get(id) !== generation) return;
      const index = this.repositories.findIndex((candidate) => candidate.id === id);
      if (index < 0) return;
      // Copias nuevas y no mutación en sitio: la vista compara referencias para
      // decidir si algo cambió, y mutar el array la dejaría sin enterarse.
      const siguientes = [...this.repositories];
      siguientes[index] = repository;
      this.repositories = siguientes;
      if (documents) this.documents = new Map(this.documents).set(id, documents);
      this.problem = null;
      this.emit();
    } catch (error) {
      if (this.disposed || this.repositoryGenerations.get(id) !== generation) return;
      this.problem = error instanceof Error ? error.message : String(error);
      this.emit();
    }
  }

  /** Mantiene una vigilancia recursiva por checkout y la ajusta al catálogo. */
  private async syncWatchers(): Promise<void> {
    if (this.disposed) return;
    if (this.options.watchRepositories === false) return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    const current = new Set(
      this.repositories.filter((repository) => !repository.missing).map((repository) => repository.id),
    );
    for (const id of this.watchStops.keys()) {
      const repository = this.repositories.find((candidate) => candidate.id === id);
      if (current.has(id) && repository?.path === this.watchedPaths.get(id)) continue;
      this.stopWatcher(id);
    }
    let watch = this.options.watch;
    if (!watch) {
      try {
        ({ watch } = await import("@tauri-apps/plugin-fs"));
      } catch (error) {
        console.error("No se pudo iniciar la vigilancia de repositorios", error);
        return;
      }
    }
    for (const repository of this.repositories) {
      if (
        repository.missing
        || this.watchStops.has(repository.id)
        || this.watchStarting.has(repository.id)
      ) continue;
      this.watchStarting.add(repository.id);
      try {
        const stop = await watch(repository.path, (event) => {
          // Los objetos y logs cambian en grandes ráfagas durante fetch/push;
          // refs e index sí importan, igual que cualquier archivo de trabajo.
          const noisyGitOnly = event.paths.length > 0 && event.paths.every((path) =>
            /[\\/]\.git[\\/](?:objects|logs)[\\/]/i.test(path),
          );
          if (noisyGitOnly || this.disposed) return;
          window.clearTimeout(this.watchTimers.get(repository.id));
          this.watchTimers.set(repository.id, window.setTimeout(() => {
            this.watchTimers.delete(repository.id);
            void this.refreshRepository(repository.id, true);
          }, 450));
        }, { recursive: true, delayMs: 250 });
        const stillCurrent = this.repositories.some((candidate) =>
          candidate.id === repository.id && !candidate.missing && candidate.path === repository.path,
        );
        if (this.disposed || !stillCurrent) stop();
        else {
          this.watchStops.set(repository.id, stop);
          this.watchedPaths.set(repository.id, repository.path);
        }
      } catch (error) {
        console.error("No se pudo vigilar el repositorio", error);
      } finally {
        this.watchStarting.delete(repository.id);
      }
    }
  }

  private stopWatcher(id: number): void {
    this.watchStops.get(id)?.();
    this.watchStops.delete(id);
    this.watchedPaths.delete(id);
    window.clearTimeout(this.watchTimers.get(id));
    this.watchTimers.delete(id);
    this.repositoryGenerations.set(id, (this.repositoryGenerations.get(id) ?? 0) + 1);
  }

  /** Libera observadores y respuestas pendientes al destruir la ventana. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    // Igual que arriba: se copia porque `stopWatcher` borra del mapa.
    // oxlint-disable-next-line no-useless-spread
    for (const id of [...this.watchStops.keys()]) this.stopWatcher(id);
    for (const timer of this.watchTimers.values()) window.clearTimeout(timer);
    this.watchTimers.clear();
    this.listeners.clear();
  }

  /** El repositorio que contiene esta ruta, si alguno la contiene. */
  repositoryOf(path: string | null): ConnectedRepository | null {
    if (!path) return null;
    const target = path.replace(/\\/g, "/").toLowerCase();
    return (
      this.repositories.find((repository) =>
        target.startsWith(`${repository.path.replace(/\\/g, "/").toLowerCase()}/`),
      ) ?? null
    );
  }

  /** ¿Está esta ruta dentro de algún repositorio conectado? */
  owns(path: string | null): boolean {
    return this.repositoryOf(path) !== null;
  }
}
