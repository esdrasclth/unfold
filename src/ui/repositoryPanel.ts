import { icon } from "./icons.ts";
import {
  connectedRepositories,
  repositoryDocuments,
  repositoryState,
  touchRepository,
  type ConnectedRepository,
  type DocumentState,
  type RepositoryDocument,
} from "../repositories.ts";

const WIDTH_KEY = "unfold:repositories-width";
const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 190;
const MAX_WIDTH = 460;
type RepositoryWatch = typeof import("@tauri-apps/plugin-fs")["watch"];

export interface RepositoryPanelOptions {
  /** Abre un documento en una pestaña. */
  onOpen: (path: string, name: string) => void;
  /** Lleva al diálogo de GitHub, que es donde se conecta y se desconecta. */
  onManage: () => void;
  /** Abre la vista de cambios para confirmar y publicar. */
  onPublish: (repository: ConnectedRepository) => void;
  /** Crea un documento nuevo dentro de la copia local. */
  onCreate: (repository: ConnectedRepository) => void;
  /** Punto de inyección para pruebas DOM; en la aplicación siempre se vigila. */
  watchRepositories?: boolean;
  watch?: RepositoryWatch;
}

/** Un nivel del árbol: carpetas dentro de carpetas, y documentos al final. */
interface Folder {
  name: string;
  path: string;
  folders: Map<string, Folder>;
  documents: RepositoryDocument[];
}

/**
 * Normaliza para buscar: sin mayúsculas y sin tildes.
 *
 * Sin quitar las tildes, escribir «guia» no encontraría «guía», que es
 * justamente lo que uno teclea con prisa.
 */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function nameOf(relative: string): string {
  return relative.split("/").pop() ?? relative;
}

function folderOf(relative: string): string {
  const parts = relative.split("/");
  parts.pop();
  return parts.join("/");
}

function emptyFolder(name: string, path: string): Folder {
  return { name, path, folders: new Map(), documents: [] };
}

/** Convierte la lista plana de rutas en el árbol que se dibuja. */
function buildTree(documents: RepositoryDocument[]): Folder {
  const root = emptyFolder("", "");
  for (const document of documents) {
    // El último tramo es el archivo: lo que queda son las carpetas.
    const parts = document.relative.split("/");
    parts.pop();
    let node = root;
    let walked = "";
    for (const part of parts) {
      walked = walked ? `${walked}/${part}` : part;
      let next = node.folders.get(part);
      if (!next) {
        next = emptyFolder(part, walked);
        node.folders.set(part, next);
      }
      node = next;
    }
    node.documents.push(document);
  }
  return root;
}

/** Resumen de una línea: rama, cambios y distancia con el remoto. */
function summaryOf(repository: ConnectedRepository): string {
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

const STATE_LABEL: Record<DocumentState, string> = {
  synced: "",
  modified: "Con cambios sin confirmar",
  new: "Todavía no está en Git",
  conflicted: "Con un conflicto sin resolver",
};

/**
 * Explorador de repositorios.
 *
 * Comparte el hueco de la izquierda con el esquema y sólo uno de los dos está
 * desplegado a la vez: en una ventana de 480 px dos paneles abiertos no dejan
 * sitio para escribir.
 */
export class RepositoryPanel {
  private repositories: ConnectedRepository[] = [];
  private documents = new Map<number, RepositoryDocument[]>();
  private collapsedRepos = new Set<number>();
  private collapsedFolders = new Set<string>();
  private activePath: string | null = null;
  private query = "";
  private loading = false;
  private problem: string | null = null;
  private width = DEFAULT_WIDTH;
  /** Cada carga cancela el pintado de la anterior. */
  private generation = 0;
  private readonly watchStops = new Map<number, () => void>();
  private readonly watchStarting = new Set<number>();
  private readonly watchedPaths = new Map<number, string>();
  private readonly watchTimers = new Map<number, number>();
  private readonly repositoryGenerations = new Map<number, number>();
  private disposed = false;

  private readonly inner: HTMLElement;
  private readonly list: HTMLElement;
  private readonly filter: HTMLInputElement;
  private readonly root: HTMLElement;
  private readonly options: RepositoryPanelOptions;

  constructor(root: HTMLElement, options: RepositoryPanelOptions) {
    this.root = root;
    this.options = options;
    this.root.innerHTML = `
      <div class="repos-inner">
        <div class="repos-head">
          <span>Repositorios</span>
          <button class="repos-icon" id="repos-refresh" type="button" title="Actualizar el explorador">${icon("refresh")}</button>
        </div>
        <input class="repos-filter" id="repos-filter" type="search" placeholder="Buscar por nombre…"
               autocomplete="off" spellcheck="false" aria-label="Buscar documentos por nombre" />
        <div class="repos-list" id="repos-list"></div>
        <button class="repos-manage" id="repos-manage" type="button">Administrar repositorios…</button>
      </div>
      <div class="repos-resizer" id="repos-resizer" title="Arrastra para ajustar el ancho"></div>
    `;
    this.inner = this.root.querySelector<HTMLElement>(".repos-inner")!;
    this.list = this.root.querySelector<HTMLElement>("#repos-list")!;
    this.filter = this.root.querySelector<HTMLInputElement>("#repos-filter")!;

    this.applyWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH);
    this.wireResizer(this.root.querySelector<HTMLElement>("#repos-resizer")!);

    this.filter.addEventListener("input", () => {
      this.query = this.filter.value.trim();
      this.render();
    });
    // Escape limpia la búsqueda antes que cerrar nada: es lo que se espera
    // dentro de un campo de filtro.
    this.filter.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || this.filter.value === "") return;
      event.preventDefault();
      event.stopPropagation();
      this.filter.value = "";
      this.query = "";
      this.render();
    });

    this.root.querySelector("#repos-refresh")!.addEventListener("click", () => void this.refresh(true));
    this.root.querySelector("#repos-manage")!.addEventListener("click", () => this.options.onManage());
  }

  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle("is-collapsed", collapsed);
    if (collapsed) this.root.setAttribute("inert", "");
    else this.root.removeAttribute("inert");
  }

  /** Marca el documento que está en pantalla, si pertenece a un repositorio. */
  setActive(path: string | null): void {
    if (this.activePath === path) return;
    this.activePath = path;
    this.render();
  }

  focusFilter(): void {
    this.filter.focus();
    this.filter.select();
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
    this.render();

    try {
      const repositories = await connectedRepositories();
      if (generation !== this.generation) return;
      repositories.sort((left, right) => left.fullName.localeCompare(right.fullName));
      this.repositories = repositories;
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
            return [repository.id, await repositoryDocuments(repository.id)] as const;
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
      for (const id of [...this.watchStops.keys()]) this.stopWatcher(id);
      this.problem = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        this.render();
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
      const repository = await repositoryState(id);
      if (this.disposed || this.repositoryGenerations.get(id) !== generation) return;
      let documents: RepositoryDocument[] | null = null;
      if (documentsChanged && !repository.missing) {
        documents = await repositoryDocuments(id);
      }
      if (this.disposed || this.repositoryGenerations.get(id) !== generation) return;
      const index = this.repositories.findIndex((candidate) => candidate.id === id);
      if (index < 0) return;
      this.repositories[index] = repository;
      if (documents) this.documents.set(id, documents);
      this.problem = null;
      this.render();
    } catch (error) {
      if (this.disposed || this.repositoryGenerations.get(id) !== generation) return;
      this.problem = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  /** Mantiene una vigilancia recursiva por checkout y la ajusta al catálogo. */
  private async syncWatchers(): Promise<void> {
    if (this.disposed) return;
    if (this.options.watchRepositories === false) return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    const current = new Set(this.repositories.filter((repository) => !repository.missing).map((repository) => repository.id));
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
    for (const id of [...this.watchStops.keys()]) this.stopWatcher(id);
    for (const timer of this.watchTimers.values()) window.clearTimeout(timer);
    this.watchTimers.clear();
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

  // --- Pintado ---------------------------------------------------------------

  private render(): void {
    const top = this.list.scrollTop;
    this.list.replaceChildren(this.body());
    this.list.scrollTop = top;
  }

  private body(): Node {
    if (this.problem) return this.notice(this.problem);
    if (this.loading && this.repositories.length === 0) return this.notice("Leyendo repositorios…");
    if (this.repositories.length === 0) {
      return this.notice("No hay repositorios conectados. Conecta uno desde GitHub para verlo aquí.");
    }
    return this.query ? this.searchResults() : this.repositoryList();
  }

  private notice(message: string): Node {
    const paragraph = document.createElement("p");
    paragraph.className = "repos-empty";
    paragraph.textContent = message;
    return paragraph;
  }

  private repositoryList(): Node {
    const fragment = document.createDocumentFragment();
    for (const repository of this.repositories) {
      const block = document.createElement("div");
      block.className = "repo";
      const open = !this.collapsedRepos.has(repository.id);
      if (open) block.classList.add("is-open");

      const head = document.createElement("button");
      head.className = "repo-head";
      head.type = "button";
      head.setAttribute("aria-expanded", String(open));
      head.innerHTML = `
        <span class="repos-caret" aria-hidden="true">▸</span>
        <span class="repo-name"></span>
        <span class="repo-summary"></span>
      `;
      head.querySelector<HTMLElement>(".repo-name")!.textContent = repository.fullName;
      head.querySelector<HTMLElement>(".repo-summary")!.textContent = summaryOf(repository);
      head.addEventListener("click", () => {
        if (this.collapsedRepos.has(repository.id)) this.collapsedRepos.delete(repository.id);
        else this.collapsedRepos.add(repository.id);
        this.render();
      });
      block.append(head);

      if (open) {
        if (!repository.missing) block.append(this.createAction(repository));
        const publish = this.publishAction(repository);
        if (publish) block.append(publish);
        const documents = this.documents.get(repository.id) ?? [];
        if (repository.missing) {
          block.append(this.notice("La carpeta de este repositorio ya no está en el disco."));
        } else if (documents.length === 0) {
          block.append(this.notice("Sin documentos Markdown."));
        } else {
          block.append(this.folderNode(repository, buildTree(documents), 0));
        }
      }
      fragment.append(block);
    }
    return fragment;
  }

  private createAction(repository: ConnectedRepository): Node {
    const button = document.createElement("button");
    button.className = "repos-create";
    button.type = "button";
    button.textContent = "Nuevo documento";
    button.addEventListener("click", () => this.options.onCreate(repository));
    return button;
  }

  /**
   * Botón de publicar, sólo cuando hay algo que publicar.
   *
   * Distingue los dos casos porque no son el mismo trabajo: con archivos
   * tocados hay que elegir y describir; con commits ya hechos sólo falta
   * subirlos.
   */
  private publishAction(repository: ConnectedRepository): Node | null {
    if (repository.missing || !repository.canPush) return null;
    if (repository.changed === 0 && repository.ahead === 0) return null;

    const button = document.createElement("button");
    button.className = "repos-publish";
    button.type = "button";
    button.textContent =
      repository.changed > 0
        ? `Publicar cambios (${repository.changed})`
        : repository.ahead === 1
          ? "Publicar 1 commit pendiente"
          : `Publicar ${repository.ahead} commits pendientes`;
    button.addEventListener("click", () => this.options.onPublish(repository));
    return button;
  }

  /** Dibuja un nivel: primero las carpetas, después los documentos. */
  private folderNode(repository: ConnectedRepository, folder: Folder, depth: number): Node {
    const fragment = document.createDocumentFragment();

    const folders = [...folder.folders.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const child of folders) {
      const key = `${repository.id}:${child.path}`;
      const open = !this.collapsedFolders.has(key);

      const row = document.createElement("button");
      row.className = "repos-folder";
      row.type = "button";
      row.style.setProperty("--depth", String(depth));
      row.setAttribute("aria-expanded", String(open));
      row.innerHTML = `<span class="repos-caret" aria-hidden="true">▸</span><span></span>`;
      if (open) row.classList.add("is-open");
      row.querySelector("span:last-child")!.textContent = child.name;
      row.addEventListener("click", () => {
        if (open) this.collapsedFolders.add(key);
        else this.collapsedFolders.delete(key);
        this.render();
      });
      fragment.append(row);

      if (open) fragment.append(this.folderNode(repository, child, depth + 1));
    }

    for (const document_ of folder.documents) {
      fragment.append(this.documentRow(repository, document_, nameOf(document_.relative), depth));
    }
    return fragment;
  }

  /**
   * Resultados de la búsqueda: una lista plana con la carpeta al lado.
   *
   * Plana a propósito. Filtrar el árbol conservando las ramas obliga a leer
   * la jerarquía entera para encontrar dos archivos; cuando ya se sabe el
   * nombre, lo que se quiere es la lista.
   */
  private searchResults(): Node {
    const needle = fold(this.query);
    const fragment = document.createDocumentFragment();
    let total = 0;

    for (const repository of this.repositories) {
      const matches = (this.documents.get(repository.id) ?? []).filter((document_) =>
        fold(document_.relative).includes(needle),
      );
      if (matches.length === 0) continue;
      total += matches.length;

      const heading = document.createElement("div");
      heading.className = "repos-result-head";
      heading.textContent = repository.fullName;
      fragment.append(heading);

      for (const document_ of matches) {
        fragment.append(
          this.documentRow(repository, document_, nameOf(document_.relative), 0, folderOf(document_.relative)),
        );
      }
    }

    if (total === 0) return this.notice(`Ningún documento coincide con «${this.query}».`);
    return fragment;
  }

  private documentRow(
    repository: ConnectedRepository,
    document_: RepositoryDocument,
    label: string,
    depth: number,
    folder?: string,
  ): Node {
    const row = document.createElement("button");
    row.className = "repos-document";
    row.type = "button";
    row.style.setProperty("--depth", String(depth));
    if (document_.state !== "synced") row.classList.add(`is-${document_.state}`);
    if (this.activePath && this.activePath.replace(/\\/g, "/") === document_.path.replace(/\\/g, "/")) {
      row.classList.add("is-active");
    }

    row.innerHTML = `
      <span class="repos-dot" aria-hidden="true"></span>
      <span class="repos-document-name"></span>
      <span class="repos-document-folder"></span>
    `;
    row.querySelector<HTMLElement>(".repos-document-name")!.textContent = label;
    if (folder) row.querySelector<HTMLElement>(".repos-document-folder")!.textContent = folder;

    const state = STATE_LABEL[document_.state];
    row.title = state ? `${document_.relative} — ${state}` : document_.relative;

    row.addEventListener("click", () => {
      this.options.onOpen(document_.path, nameOf(document_.relative));
      void touchRepository(repository.id);
    });
    return row;
  }

  // --- Ancho -----------------------------------------------------------------

  private applyWidth(width: number): void {
    this.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
    const value = `${this.width}px`;
    this.root.style.setProperty("--repos-width", value);
    this.inner.style.setProperty("--repos-width", value);
  }

  private wireResizer(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const origin = this.root.getBoundingClientRect().left;
      this.root.classList.add("is-resizing");
      document.body.classList.add("is-resizing");

      const move = (moveEvent: PointerEvent): void => this.applyWidth(moveEvent.clientX - origin);
      const end = (): void => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        this.root.classList.remove("is-resizing");
        document.body.classList.remove("is-resizing");
        localStorage.setItem(WIDTH_KEY, String(this.width));
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });

    handle.addEventListener("dblclick", () => {
      this.applyWidth(DEFAULT_WIDTH);
      localStorage.setItem(WIDTH_KEY, String(this.width));
    });
  }
}
