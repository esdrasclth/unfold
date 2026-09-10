import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
  createEditor,
  createEditorState,
  replaceDocument,
  type EditorOptions,
} from "./editor/index.ts";
import { exportHtml, printDocument, type ExportContext } from "./export/index.ts";
import {
  chooseFileAsIn,
  extensionForImage,
  isTauri,
  makeAssetResolver,
  openFile,
  readFile,
  saveFile,
  saveFileAs,
  saveImageBeside,
  type OpenedFile,
} from "./files.ts";
import { rememberRecent } from "./recent.ts";
import { clearSession, loadSession, saveSession } from "./session.ts";
import { Tabs } from "./tabs.ts";
import { saveSnapshot } from "./saveSnapshot.ts";
import { confirmDialog } from "./ui/confirmDialog.ts";
import { RecentMenu } from "./ui/recentMenu.ts";
import { TabBar } from "./ui/tabBar.ts";
import { icon } from "./ui/icons.ts";
import { Outline } from "./ui/outline.ts";
import { RepositoryPanel } from "./ui/repositoryPanel.ts";
import { openCommitDialog } from "./ui/commitDialog.ts";
import { SettingsPanel } from "./ui/settings.ts";
import { mountWindowControls } from "./ui/windowControls.ts";
import { restablecerVersionOmitida } from "./updates.ts";
import { mountUpdateBanner } from "./ui/updateBanner.ts";
import { FileWatcher } from "./watcher.ts";
import { closeMarkdownMenu, openMarkdownMenu } from "./ui/markdownMenu.ts";
import { openCommandPalette } from "./ui/commandPalette.ts";
import { paletteCommands, type PaletteActions } from "./ui/paletteCommands.ts";
import { aplicarTemaGuardado, mountViewModes } from "./ui/viewModes.ts";
import { openDocumentSearch } from "./ui/searchDocuments.ts";
import { historyKey, loadHistory, recordVersion } from "./history.ts";
import { migrarDesdeLocalStorage } from "./store.ts";
import { openHistoryDialog } from "./ui/historyDialog.ts";
import { openGithubDialog } from "./ui/githubDialog.ts";
import { githubAuthStatus, type GithubAuthStatus } from "./github.ts";
import {
  connectedRepositories,
  createRepositoryDocumentFile,
  type ConnectedRepository,
} from "./repositories.ts";
import { chooseFolder, folderCreateDocument, isFolder, openFolder } from "./folders.ts";
import { backupFolder, createBackup, limpiarIndiceViejo, restoreLatest, setBackupFolder } from "./backups.ts";
import { takeWelcome } from "./welcome.ts";
import "./styles/app.css";
import "./styles/markdown.css";

/**
 * `session` sigue siendo el documento en pantalla, pero ahora es una vista
 * sobre la pestaña activa: se lee y se escribe a través de ella para no tener
 * que tocar cada uso repartido por el archivo.
 */
const session = {
  get path(): string | null {
    return tabs.active().path;
  },
  set path(value: string | null) {
    tabs.active().path = value;
  },
  get name(): string {
    return tabs.active().name;
  },
  set name(value: string) {
    tabs.active().name = value;
    tabs.touch();
  },
  get dirty(): boolean {
    return tabs.active().dirty;
  },
  set dirty(value: boolean) {
    tabs.active().dirty = value;
    tabs.touch();
  },
};

let view: EditorView;
let tabs: Tabs;
let tabBar: TabBar;
let recentMenu: RecentMenu;
let outline: Outline;
let repositoryPanel: RepositoryPanel;
let autosaveTimer: number | undefined;
let sessionSaveTimer: number | undefined;
let backupTimer: number | undefined;
/** La guía inicial se descarta al abrir el primer archivo si no se editó. */
let welcomeTabId: number | null = null;
/** Contenido externo pendiente de resolver mientras hay conflicto. */
let conflictContent: string | null = null;
const tabConflicts = new Map<number, string>();

// --- Construcción de la interfaz ---------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="titlebar" data-tauri-drag-region>
    <button class="icon-button titlebar-panel" id="btn-outline" title="Esquema (Ctrl+Shift+O)">${icon("panel")}</button>
    <button class="icon-button titlebar-panel" id="btn-repositories" title="Repositorios (Ctrl+Shift+B)">${icon("repositories")}</button>
    <div class="titlebar-file is-compact">
      <span class="titlebar-icon">${icon("file")}</span>
      <span class="titlebar-name" id="doc-name">Sin título</span>
      <span class="titlebar-status" id="doc-status"></span>
    </div>
    <!--
      Cuatro grupos, y dentro de cada uno los botones pegados: el archivo, lo
      que sale de él, cómo se escribe y cómo se ve. Doce iconos seguidos a la
      misma distancia obligan a leerlos uno a uno para encontrar el que se
      busca; separados por lo que hacen, se va directo al grupo.
    -->
    <div class="titlebar-actions">
      <div class="titlebar-group">
        <button class="icon-button" id="btn-recent" title="Recientes">${icon("clock")}</button>
        <button class="icon-button" id="btn-open" title="Abrir (Ctrl+O)">${icon("open")}</button>
        <button class="icon-button" id="btn-save" title="Guardar (Ctrl+S)">${icon("save")}</button>
        <button class="icon-button" id="btn-search" title="Buscar (Ctrl+F)">${icon("search")}</button>
      </div>
      <div class="titlebar-group">
        <button class="icon-button" id="btn-github" title="GitHub (Ctrl+Shift+H)">${icon("github")}</button>
        <button class="icon-button" id="btn-export" title="Exportar a HTML (Ctrl+Shift+E)">${icon("export")}</button>
        <button class="icon-button" id="btn-print" title="Imprimir o guardar en PDF (Ctrl+P)">${icon("print")}</button>
      </div>
      <div class="titlebar-group">
        <button class="icon-button" id="btn-source" title="Código fuente (Ctrl+Shift+M)">${icon("code")}</button>
        <button class="icon-button" id="btn-focus" title="Modo enfoque (Ctrl+Shift+F)">${icon("focus")}</button>
        <button class="icon-button" id="btn-typewriter" title="Modo máquina de escribir (Ctrl+Shift+T)">${icon("typewriter")}</button>
      </div>
      <div class="titlebar-group">
        <button class="icon-button" id="btn-theme" title="Cambiar tema">${icon("moon")}</button>
        <button class="icon-button" id="btn-settings" title="Apariencia (Ctrl+,)">${icon("sliders")}</button>
      </div>
    </div>
    <div class="window-controls" id="window-controls"></div>
  </header>
  <div class="update-bar" id="update" hidden>
    <span class="update-text" id="update-text"></span>
    <button class="update-action" id="update-now">Actualizar</button>
    <button class="update-action is-quiet" id="update-later">Más tarde</button>
  </div>
  <div class="conflict-bar" id="conflict" hidden>
    <span class="conflict-text">Este archivo ha cambiado fuera de Unfold y tienes cambios sin guardar.</span>
    <button class="conflict-action" id="conflict-reload">Cargar la versión del disco</button>
    <button class="conflict-action is-quiet" id="conflict-keep">Mantener la mía</button>
  </div>
  <div class="workspace">
    <aside class="repositories is-collapsed" id="repositories" inert></aside>
    <aside class="outline is-collapsed" id="outline" inert></aside>
    <div class="editor-column">
      <div class="tab-bar" id="tab-bar" hidden></div>
      <main class="editor-host" id="editor-host"></main>
    </div>
    <aside class="settings" id="settings" inert></aside>
  </div>
  <footer class="statusbar">
    <span id="stat-words">0 palabras</span>
    <span id="stat-chars">0 caracteres</span>
    <span id="stat-read">1 min de lectura</span>
    <span id="stat-caret">Ln 1, Col 1</span>
  </footer>
`;

const el = {
  name: document.querySelector<HTMLElement>("#doc-name")!,
  status: document.querySelector<HTMLElement>("#doc-status")!,
  host: document.querySelector<HTMLElement>("#editor-host")!,
  outline: document.querySelector<HTMLElement>("#outline")!,
  conflict: document.querySelector<HTMLElement>("#conflict")!,
  words: document.querySelector<HTMLElement>("#stat-words")!,
  chars: document.querySelector<HTMLElement>("#stat-chars")!,
  read: document.querySelector<HTMLElement>("#stat-read")!,
  caret: document.querySelector<HTMLElement>("#stat-caret")!,
  theme: document.querySelector<HTMLButtonElement>("#btn-theme")!,
  typewriter: document.querySelector<HTMLButtonElement>("#btn-typewriter")!,
  source: document.querySelector<HTMLButtonElement>("#btn-source")!,
  outlineButton: document.querySelector<HTMLButtonElement>("#btn-outline")!,
  repositories: document.querySelector<HTMLElement>("#repositories")!,
  repositoriesButton: document.querySelector<HTMLButtonElement>("#btn-repositories")!,
  settings: document.querySelector<HTMLElement>("#settings")!,
  settingsButton: document.querySelector<HTMLButtonElement>("#btn-settings")!,
  recentButton: document.querySelector<HTMLButtonElement>("#btn-recent")!,
  githubButton: document.querySelector<HTMLButtonElement>("#btn-github")!,
  tabBar: document.querySelector<HTMLElement>("#tab-bar")!,
  update: document.querySelector<HTMLElement>("#update")!,
  updateText: document.querySelector<HTMLElement>("#update-text")!,
  updateNow: document.querySelector<HTMLButtonElement>("#update-now")!,
  updateLater: document.querySelector<HTMLButtonElement>("#update-later")!,
};

/**
 * Nombre de una pestaña sin archivo, sacado de su primera línea con contenido.
 * Con varios documentos nuevos abiertos, «Sin título» repetido no distingue
 * ninguno; su propio título sí.
 */
function titleFromDoc(doc: string): string {
  const first = doc.split("\n").find((line) => line.trim().length > 0) ?? "";
  const clean = first
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/[*_`~[\]]/g, "")
    .trim();
  return clean ? clean.slice(0, 32) : "Sin título";
}

/** Aviso breve en la barra de título; se borra solo. */
let noticeTimer: number | undefined;
function notify(message: string): void {
  window.clearTimeout(noticeTimer);
  el.status.textContent = message;
  el.status.classList.add("is-notice");
  noticeTimer = window.setTimeout(() => {
    el.status.classList.remove("is-notice");
    renderHeader();
  }, 3000);
}

// --- Estado visible -----------------------------------------------------------

function renderHeader(): void {
  el.name.textContent = session.name;
  el.status.textContent = session.dirty ? "sin guardar" : session.path ? "guardado" : "";
  el.status.classList.toggle("is-dirty", session.dirty);
  el.status.setAttribute("role", "status");
  el.status.setAttribute("aria-live", "polite");
  el.status.setAttribute("aria-label", session.dirty ? "Documento sin guardar" : "Documento guardado");
}

function renderStats(doc: string): void {
  const words = doc.trim() ? doc.trim().split(/\s+/).length : 0;
  el.words.textContent = `${words.toLocaleString("es")} ${words === 1 ? "palabra" : "palabras"}`;
  el.chars.textContent = `${doc.length.toLocaleString("es")} caracteres`;
  el.read.textContent = `${Math.max(1, Math.round(words / 200))} min de lectura`;
}

/** Guarda pestañas, borradores y posición sin escribir los archivos del usuario. */
/**
 * Guarda la sesión y devuelve la promesa de que llegó al disco.
 *
 * Casi todos los sitios la descartan: guardar ocurre al teclear y al cerrar
 * pestañas, y el disco no puede meterse en medio de eso. Pero al cerrar la
 * ventana hay que esperarla, porque después se destruye el proceso y una
 * escritura a medio camino se pierde entera —y es justo la escritura que
 * lleva los borradores sin guardar—.
 */
function saveCurrentSession(): Promise<void> {
  const snapshot = tabs.snapshot(view, welcomeTabId ?? undefined);
  return snapshot.tabs.length === 0 ? clearSession() : saveSession(snapshot);
}

function scheduleSessionSave(): void {
  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(() => void saveCurrentSession(), 250);
}

function scheduleBackup(): void {
  window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => {
    const key = historyKey(session.path, session.name);
    void createBackup(key, view.state.doc.toString());
  }, 30_000);
}

// --- Vigilancia del archivo ---------------------------------------------------

const watcher = new FileWatcher({
  currentContent: () => view.state.doc.toString(),
  isDirty: () => session.dirty,
  onReload: (content) => {
    // Sin cambios locales que perder, adoptamos el disco sin preguntar.
    replaceDocument(view, content);
    session.dirty = false;
    renderHeader();
    renderStats(content);
    notify("Recargado: el archivo cambió fuera de Unfold");
  },
  onConflict: (content) => {
    tabConflicts.set(tabs.active().id, content);
    conflictContent = content;
    el.conflict.hidden = false;
    // Mientras haya conflicto no autoguardamos: sobrescribiría el disco.
    window.clearTimeout(autosaveTimer);
  },
  onRemoved: () => notify("El archivo ya no está donde estaba"),
});

function resolveConflict(keepMine: boolean): void {
  tabConflicts.delete(tabs.active().id);
  if (!keepMine && conflictContent !== null) {
    replaceDocument(view, conflictContent);
    session.dirty = false;
    renderStats(conflictContent);
  }
  conflictContent = null;
  el.conflict.hidden = true;
  renderHeader();
  view.focus();
  if (keepMine) scheduleAutosave();
}

// --- Acciones -----------------------------------------------------------------

function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  if (!session.path || conflictContent !== null) return;
  // Guardado silencioso un segundo después de dejar de escribir.
  const tabId = tabs.active().id;
  autosaveTimer = window.setTimeout(() => {
    if (tabs.active().id === tabId) void persist(false);
  }, 1000);
}

let saving: Promise<boolean> | null = null;
async function persist(prompt: boolean): Promise<boolean> {
  const requestedTab = tabs.active();
  if (saving) {
    await saving;
    if (tabs.active() !== requestedTab) return false;
    return persist(prompt);
  }
  saving = persistActive(prompt);
  try { return await saving; } finally { saving = null; }
}

async function persistActive(prompt: boolean): Promise<boolean> {
  window.clearTimeout(autosaveTimer);
  const tab = tabs.active();
  const content = view.state.doc.toString();
  try {
    watcher.noteSelfWrite(content);
    const saved = await saveSnapshot(tab, content,
      () => prompt ? saveFileAs(content) : saveFile(tab.path, content),
      () => (tabs.active() === tab ? view.state : tab.state).doc.toString());
    if (!saved) return false;
    tabConflicts.delete(tab.id);
    if (tabs.active() === tab) {
      conflictContent = null;
      el.conflict.hidden = true;
      void watcher.watch(tab.path);
      renderHeader();
    }
    tabs.touch();
    scheduleSessionSave();
    // Guardar cambia el estado del archivo en Git —de sincronizado a
    // modificado, o de nuevo a modificado—, así que el explorador se queda
    // mintiendo si no se relee. Sólo si está abierto y el archivo es suyo.
    if (repositoriesOn && repositoryPanel.owns(tab.path)) void repositoryPanel.refreshPath(tab.path);
    return !tab.dirty;
  } catch (error) {
    console.error("No se pudo guardar", error);
    notify("No se pudo guardar el archivo; tus cambios siguen en el editor");
    return false;
  }
}

function applyFile(file: OpenedFile): void {
  conflictContent = null;
  el.conflict.hidden = true;
  const welcomeTab = welcomeTabId === null
    ? undefined
    : tabs.list().find((tab) => tab.id === welcomeTabId);
  const discardWelcome = Boolean(welcomeTab && !welcomeTab.dirty && welcomeTab.path === null);
  tabs.open(view, file.path, file.name, file.content);
  if (discardWelcome && welcomeTab) {
    tabs.close(view, welcomeTab.id);
    welcomeTabId = null;
  }
  rememberRecent(file.path, file.name);
  afterTabChange();
}

/** Todo lo que hay que refrescar cuando cambia el documento en pantalla. */
function afterTabChange(): void {
  window.clearTimeout(autosaveTimer);
  conflictContent = tabConflicts.get(tabs.active().id) ?? null;
  el.conflict.hidden = conflictContent === null;
  const doc = view.state.doc.toString();
  renderHeader();
  renderStats(doc);
  outline.refresh();
  repositoryPanel.setActive(session.path);
  // El modo máquina de escribir vive en un compartimento del estado, y el
  // estado nuevo trae el suyo vacío: hay que reponerlo en cada cambio.
  modos.aplicar();
  scheduleSessionSave();
  void watcher.watch(session.path);
  view.focus();
}

async function load(): Promise<void> {
  try {
    const file = await openFile();
    if (file) applyFile(file);
  } catch (error) {
    console.error("No se pudo abrir", error);
    notify("No se pudo abrir el archivo");
  }
}

/** Abre una ruta concreta: usada por el arranque con argumento y por arrastrar. */
async function loadPath(path: string): Promise<void> {
  try {
    applyFile({
      path,
      name: path.split(/[\\/]/).pop() ?? path,
      content: await readFile(path),
    });
  } catch (error) {
    console.error("No se pudo abrir", path, error);
    notify("No se pudo abrir el archivo");
  }
}

/**
 * Guarda si hace falta antes de una acción que descarta el documento.
 * Devuelve false si el usuario decide quedarse donde está.
 */
async function confirmDiscard(accion: string): Promise<boolean> {
  if (!session.dirty) return true;

  // Con archivo y sin conflicto, guardar es lo que el autoguardado ya promete:
  // no hay nada que preguntar.
  if (session.path && conflictContent === null) {
    return persist(false);
  }

  const choice = await confirmDialog(
    "Cambios sin guardar",
    `«${session.name}» tiene cambios que aún no están en disco. ¿Qué hacemos antes de ${accion}?`,
    [
      { label: "Guardar", value: "guardar", primary: true },
      { label: "Descartar", value: "descartar" },
      { label: "Cancelar", value: "cancelar", cancel: true },
    ],
  );

  if (choice === "cancelar") return false;
  if (choice === "guardar") {
    return persist(false);
  }
  return true;
}

/** Ctrl+N abre una pestaña más; no reemplaza lo que estabas escribiendo. */
function newDocument(): void {
  conflictContent = null;
  el.conflict.hidden = true;
  tabs.create(view);
  afterTabChange();
}

async function switchTab(id: number): Promise<void> {
  if (id === tabs.active().id) return;
  // Se guarda lo pendiente de la que se abandona: al volver debe estar como
  // se dejó, y el autoguardado de la otra ya no se dispararía.
  if (session.dirty && session.path && conflictContent === null && !(await persist(false))) return;
  conflictContent = null;
  el.conflict.hidden = true;
  tabs.activate(view, id);
  afterTabChange();
}

async function closeTab(id: number): Promise<void> {
  const target = tabs.list().find((tab) => tab.id === id);
  if (!target) return;

  if (target.dirty) {
    // Se trae al frente antes de preguntar: no se decide a ciegas sobre un
    // documento que no se está viendo.
    await switchTab(id);
    if (tabs.active().id !== id) return;
    if (!(await confirmDiscard("cerrar la pestaña"))) return;
  }

  tabs.close(view, id);
  tabConflicts.delete(id);
  if (id === welcomeTabId) welcomeTabId = null;
  conflictContent = null;
  el.conflict.hidden = true;
  afterTabChange();
}

function exportContext(): ExportContext {
  return {
    markdown: view.state.doc.toString(),
    title: session.name.replace(/\.[^.]+$/, ""),
    documentPath: session.path,
    resolveAsset: makeAssetResolver(() => session.path),
    notify,
  };
}

// --- Modos --------------------------------------------------------------------


let settingsPanel: SettingsPanel;
let settingsOpen = false;

function toggleSettings(force?: boolean): void {
  settingsOpen = force ?? !settingsOpen;
  settingsPanel.setOpen(settingsOpen);
  el.settingsButton.classList.toggle("is-on", settingsOpen);
  if (!settingsOpen) view.focus();
}

/*
 * GitHub. El botón sólo refleja si hay sesión: los repositorios se piden
 * cuando se abre el diálogo, no en cada arranque, porque el editor tiene que
 * poder trabajar sin red.
 */
let repositoryCount = 0;
let lastGithubStatus: GithubAuthStatus = { connected: false, user: null, expiresAt: null };

function paintGithub(status: GithubAuthStatus): void {
  lastGithubStatus = status;
  el.githubButton.classList.toggle("is-on", status.connected || repositoryCount > 0);
  const account = status.connected ? ` · @${status.user?.login ?? ""}` : "";
  const repositories =
    repositoryCount === 1 ? " · 1 repositorio" : repositoryCount > 1 ? ` · ${repositoryCount} repositorios` : "";
  el.githubButton.title = `GitHub${account}${repositories} (Ctrl+Shift+H)`;
  repositoryPanel?.setAccount(status);
}

function showCommit(repository: ConnectedRepository): void {
  openCommitDialog(repository, {
    onChanged: () => void repositoryPanel.refreshRepository(repository.id, true),
    notify,
  });
}

/** Abre el buscador de todos los documentos y lleva al resultado elegido. */
function buscarEnDocumentos(): void {
  openDocumentSearch((path, line) => {
    void (async () => {
      await loadPath(path);
      // Ya está el documento: se lleva el cursor a la línea, que es a lo que
      // se venía. `Math.min` porque el archivo pudo cambiar desde la búsqueda.
      const numero = Math.min(Math.max(1, line), view.state.doc.lines);
      const posicion = view.state.doc.line(numero).from;
      view.dispatch({ selection: { anchor: posicion }, scrollIntoView: true });
      view.focus();
    })();
  });
}

async function addFolder(): Promise<void> {
  try {
    const elegida = await chooseFolder();
    if (!elegida) return;
    const carpeta = await openFolder(elegida);
    toggleRepositories(true);
    await repositoryPanel.refresh(true);
    notify(`«${carpeta.name}» está en el explorador`);
  } catch (error) {
    console.error("No se pudo abrir la carpeta", error);
    notify(typeof error === "string" ? error : "No se pudo abrir la carpeta");
  }
}

async function createRepositoryDocument(repository: ConnectedRepository): Promise<void> {
  try {
    const target = await chooseFileAsIn(repository.path);
    if (!target) return;
    // La carpeta y el repositorio validan igual, pero cada uno conoce su
    // propia raíz: el comando se elige por el signo del identificador.
    const { path, created } = isFolder(repository)
      ? await folderCreateDocument(repository.id, target)
      : await createRepositoryDocumentFile(repository.id, target);
    // Se lee del disco en los dos casos: el recién creado llega vacío, y el que
    // ya estaba llega con su contenido, que es justo lo que no hay que perder.
    await loadPath(path);
    if (created) await repositoryPanel.refreshRepository(repository.id, true);
    notify(
      created
        ? "Documento creado en el repositorio"
        : "Ese documento ya existía: se ha abierto sin tocarlo",
    );
  } catch (error) {
    console.error("No se pudo crear el documento", error);
    // Los motivos del backend están escritos para leerse —qué extensión hace
    // falta, que la ruta es una carpeta—, así que se enseñan en vez de taparlos
    // con un «no se pudo» que obliga a adivinar.
    notify(
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "No se pudo crear el documento en el repositorio",
    );
  }
}

/**
 * Publica el repositorio del documento que está en pantalla.
 *
 * El catálogo puede estar sin leer si nunca se abrió el panel, así que se
 * refresca antes de darse por vencido.
 */
function publishCurrent(): void {
  void (async () => {
    let repository = repositoryPanel.repositoryOf(session.path);
    if (!repository) {
      await repositoryPanel.refresh();
      repository = repositoryPanel.repositoryOf(session.path);
    }
    if (!repository) {
      notify("Este documento no está dentro de un repositorio conectado");
      return;
    }
    showCommit(repository);
  })();
}

function showGithub(): void {
  openGithubDialog({
    onStatusChange: paintGithub,
    // Un documento del repositorio es un archivo normal del disco: se abre
    // como cualquier otro y hereda pestañas, sesión y recientes sin nada más.
    onOpenDocument: (path) => void loadPath(path),
    onRepositoriesChange: (count) => {
      repositoryCount = count;
      paintGithub(lastGithubStatus);
      if (repositoriesOn) void repositoryPanel.refresh();
    },
  });
}

/*
 * El hueco de la izquierda lo comparten el esquema y el explorador de
 * repositorios, y sólo uno está desplegado a la vez. La ventana puede bajar a
 * 480 px de ancho: con los dos abiertos no quedaría sitio para escribir.
 */
let outlineOn = localStorage.getItem("unfold:outline") === "on";
let repositoriesOn = localStorage.getItem("unfold:repositories") === "on";

function applySidePanels(): void {
  outline.setCollapsed(!outlineOn);
  repositoryPanel.setCollapsed(!repositoriesOn);
  el.outlineButton.classList.toggle("is-on", outlineOn);
  el.repositoriesButton.classList.toggle("is-on", repositoriesOn);
  if (outlineOn) outline.refresh();
  // También al arrancar: si el panel se quedó abierto de la sesión anterior,
  // se restauraría vacío hasta que alguien pulsara actualizar.
  if (repositoriesOn) {
    repositoryPanel.setActive(session.path);
    void repositoryPanel.refresh();
  }
}

/** Se conserva el nombre porque lo usan la paleta y el atajo de siempre. */
function applyOutline(): void {
  applySidePanels();
}

function toggleOutline(): void {
  outlineOn = !outlineOn;
  if (outlineOn) repositoriesOn = false;
  localStorage.setItem("unfold:outline", outlineOn ? "on" : "off");
  localStorage.setItem("unfold:repositories", repositoriesOn ? "on" : "off");
  applySidePanels();
  view.focus();
}

function toggleRepositories(force?: boolean): void {
  repositoriesOn = force ?? !repositoriesOn;
  if (repositoriesOn) outlineOn = false;
  localStorage.setItem("unfold:outline", outlineOn ? "on" : "off");
  localStorage.setItem("unfold:repositories", repositoriesOn ? "on" : "off");
  applySidePanels();
  if (!repositoriesOn) view.focus();
}

// --- Arranque -----------------------------------------------------------------

aplicarTemaGuardado(el.theme);

const initialDocument = takeWelcome();

const editorOptions: EditorOptions = {
  parent: el.host,
  doc: initialDocument,
  resolveAsset: makeAssetResolver(() => session.path),
  onSelection: (line, column) => {
    el.caret.textContent = `Ln ${line}, Col ${column}`;
    if (outlineOn) outline.refresh();
    scheduleSessionSave();
    scheduleBackup();
  },
  onChange: (doc) => {
    if (doc.split("\n").length >= 10_000) {
      const started = performance.now();
      queueMicrotask(() => console.info(`[Unfold] documento grande: ${doc.split("\n").length.toLocaleString("es")} líneas; actualización ${Math.round(performance.now() - started)} ms`));
    }
    // La guía inicial deja de ser efímera en cuanto el usuario la edita.
    if (welcomeTabId !== null && tabs.active().id === welcomeTabId) welcomeTabId = null;
    session.dirty = true;
    if (!session.path) session.name = titleFromDoc(doc);
    renderHeader();
    renderStats(doc);
    scheduleAutosave();
    if (outlineOn) outline.refresh();
    scheduleSessionSave();
    recordVersion(historyKey(session.path, session.name), doc);
  },
  links: {
    notify,
    documentPath: () => session.path,
    openDocument: (path) => void loadPath(path),
  },
  paste: {
    notify,
    saveImage: async (data, mime) => {
      if (!isTauri) {
        notify("Pegar imágenes requiere la aplicación de escritorio");
        return null;
      }
      // La imagen se guarda junto al documento, así que hace falta uno.
      if (!session.path) {
        notify("Guarda el documento antes de pegar imágenes");
        return null;
      }
      try {
        const relative = await saveImageBeside(session.path, data, extensionForImage(mime));
        notify(`Imagen guardada en ${relative}`);
        return relative;
      } catch (error) {
        console.error("No se pudo guardar la imagen", error);
        notify("No se pudo guardar la imagen");
        return null;
      }
    },
  },
};

view = createEditor(editorOptions);
const modos = mountViewModes(view, el);

tabs = new Tabs(
  (doc) => createEditorState(doc, editorOptions),
  () => tabBar.render(tabs.list(), tabs.active().id),
);
tabBar = new TabBar(el.tabBar, {
  activate: (id) => void switchTab(id),
  close: (id) => void closeTab(id),
});
const initialTab = tabs.adopt(view.state, titleFromDoc(initialDocument));
if (initialDocument) welcomeTabId = initialTab.id;

recentMenu = new RecentMenu(el.recentButton, {
  open: (path) => void loadPath(path),
  browse: () => void load(),
});

outline = new Outline(el.outline, () => view);
repositoryPanel = new RepositoryPanel(el.repositories, {
  onOpen: (path) => void loadPath(path),
  onManage: showGithub,
  onPublish: showCommit,
  onCreate: (repository) => void createRepositoryDocument(repository),
  onAddFolder: () => void addFolder(),
});
window.addEventListener("beforeunload", () => repositoryPanel.dispose());
mountWindowControls(document.querySelector<HTMLElement>("#window-controls")!);
const actualizaciones = mountUpdateBanner(el, {
  notify,
  guardarSesion: saveCurrentSession,
});
settingsPanel = new SettingsPanel(el.settings, () => toggleSettings(false), {
  check: () => actualizaciones.comprobar(true),
  resetDismissed: () => {
    restablecerVersionOmitida();
    actualizaciones.comprobar(true);
  },
});

renderHeader();
renderStats(initialDocument);
modos.aplicar();
applyOutline();
view.focus();

/**
 * Sube a disco lo que quedara en `localStorage` y carga el historial.
 *
 * Antes que restaurar la sesión, porque la sesión también se lee de ahí: si se
 * hiciera al revés, la primera vez tras actualizar se abriría en blanco.
 */
async function prepararEstado(): Promise<void> {
  await migrarDesdeLocalStorage();
  limpiarIndiceViejo();
  await loadHistory();
}

async function restoreSession(): Promise<void> {
  const saved = await loadSession();
  if (!saved) return;

  // Los archivos limpios se leen de nuevo desde disco; los sucios conservan
  // el borrador local para no perder cambios que aún no llegaron al archivo.
  const snapshots = [];
  for (const snapshot of saved.tabs) {
    if (isTauri && snapshot.path && !snapshot.dirty) {
      try {
        snapshot.content = await readFile(snapshot.path);
      } catch {
        continue;
      }
    }
    snapshots.push(snapshot);
  }
  if (snapshots.length === 0) {
    void clearSession();
    return;
  }
  tabs.restore(view, snapshots, saved.active);
  welcomeTabId = null;
  afterTabChange();
}

document.querySelector("#btn-open")!.addEventListener("click", () => void load());
document.querySelector("#btn-save")!.addEventListener("click", () => void persist(false));
document.querySelector("#btn-search")!.addEventListener("click", () => openSearchPanel(view));
document.querySelector("#btn-export")!.addEventListener("click", () => void exportHtml(exportContext()));
document.querySelector("#btn-print")!.addEventListener("click", () => printDocument(exportContext()));
el.githubButton.addEventListener("click", showGithub);
window.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    openCommandPalette(paletteCommands(accionesPaleta));
  }
});
document.querySelector("#btn-focus")!.addEventListener("click", () => modos.alternarEnfoque());
el.outlineButton.addEventListener("click", toggleOutline);
el.repositoriesButton.addEventListener("click", () => toggleRepositories());
el.typewriter.addEventListener("click", () => modos.alternarMaquinaDeEscribir());
el.source.addEventListener("click", () => modos.alternarCodigoFuente());
el.theme.addEventListener("click", () => modos.alternarTema());
el.settingsButton.addEventListener("click", () => toggleSettings());
el.recentButton.addEventListener("click", () => recentMenu.toggle());
async function configurarCarpetaCopias(): Promise<void> {
  if (!isTauri) {
    notify("Las copias automáticas requieren la aplicación de escritorio");
    return;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const folder = await open({ directory: true, defaultPath: backupFolder() ?? undefined });
  if (typeof folder !== "string") return;
  setBackupFolder(folder);
  notify("Carpeta de copias guardada");
}

async function recuperarCopia(): Promise<void> {
  const content = await restoreLatest(historyKey(session.path, session.name));
  if (!content) {
    notify("No hay una copia automática disponible");
    return;
  }
  replaceDocument(view, content);
  notify("Última copia restaurada");
}

const accionesPaleta: PaletteActions = {
  nuevo: newDocument,
  abrir: () => void load(),
  guardar: () => void persist(false),
  exportar: () => void exportHtml(exportContext()),
  imprimir: () => void printDocument(exportContext()),
  alternarCodigoFuente: modos.alternarCodigoFuente,
  alternarEnfoque: modos.alternarEnfoque,
  alternarTema: modos.alternarTema,
  abrirAjustes: () => toggleSettings(true),
  abrirExplorador: () => toggleRepositories(true),
  buscarPorNombre: () => {
    toggleRepositories(true);
    repositoryPanel.focusFilter();
  },
  buscarEnDocumentos,
  publicar: publishCurrent,
  abrirGithub: showGithub,
  verHistorial: () =>
    openHistoryDialog(historyKey(session.path, session.name), view.state.doc.toString(), (content) =>
      replaceDocument(view, content),
    ),
  configurarCarpetaCopias: () => void configurarCarpetaCopias(),
  recuperarCopia: () => void recuperarCopia(),
  enCodigoFuente: modos.enCodigoFuente,
  carpetaCopias: backupFolder,
};

function chooseImage(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    void (async () => {
      if (!isTauri || !session.path) { notify("Guarda el documento antes de insertar imágenes"); return; }
      try {
        const relative = await saveImageBeside(session.path, new Uint8Array(await file.arrayBuffer()), extensionForImage(file.type));
        const head = view.state.selection.main.head;
        const text = `![${file.name.replace(/\.[^.]+$/, "")}](${relative})`;
        view.dispatch({ changes: { from: head, to: head, insert: text }, selection: { anchor: head + text.length } });
        notify("Imagen insertada");
      } catch { notify("No se pudo insertar la imagen"); }
    })();
  });
  input.click();
}
view.dom.addEventListener("contextmenu", (event) => {
  openMarkdownMenu(event, view, modos.enCodigoFuente(), modos.alternarCodigoFuente, chooseImage);
});
window.addEventListener("resize", closeMarkdownMenu);

document.querySelector("#conflict-reload")!.addEventListener("click", () => resolveConflict(false));
document.querySelector("#conflict-keep")!.addEventListener("click", () => resolveConflict(true));

// Integración con el escritorio: abrir un .md desde el explorador y soltar
// archivos sobre la ventana.
if (isTauri) {
  void (async () => {
    const [{ invoke }, { getCurrentWebview }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/webview"),
    ]);

    // Cerrar la ventana pasa antes por aquí: sin esto, un documento nuevo sin
    // guardar se perdía en silencio (el autoguardado sólo actúa si ya hay
    // archivo). Se cancela el cierre y se destruye después de decidir, porque
    // volver a llamar a close() dispararía este mismo manejador otra vez.
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    let closing = false;

    await appWindow.onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();

      // Se repasan todas las pestañas con cambios, no sólo la que se ve: la
      // ventana se lleva por delante también las de detrás.
      while (tabs.dirtyTabs().length > 0) {
        const pending = tabs.dirtyTabs()[0];
        await switchTab(pending.id);
        if (tabs.active().id !== pending.id) return;
        if (!(await confirmDiscard("cerrar"))) return;
        // Si se descartó, la pestaña sigue marcada como sucia: se limpia para
        // no volver a preguntar por ella en la siguiente vuelta.
        pending.dirty = false;
        void saveCurrentSession();
      }

      closing = true;
      await saveCurrentSession();
      await appWindow.destroy();
    });

    await prepararEstado();
    const startup = await invoke<string | null>("startup_file");
    if (startup) await loadPath(startup);
    else await restoreSession();

    /*
     * Abrir un `.md` con Unfold ya abierto no arranca otro proceso: el guardia
     * de instancia única se lo pasa a ésta. Sin escuchar aquí, el segundo
     * doble clic traería la ventana al frente sin abrir nada, que se parece
     * demasiado a que la aplicación se haya quedado colgada.
     */
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("unfold://open-file", (event) => {
      if (event.payload) void loadPath(event.payload);
    });

    await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const dropped = event.payload.paths.find((path) => /\.(md|markdown|mdx|txt)$/i.test(path));
      if (dropped) void loadPath(dropped);
    });
  })();
} else {
  void prepararEstado().then(restoreSession);
}

// El puntero sólo se vuelve mano sobre los enlaces mientras se mantiene Ctrl:
// con clic normal hay que poder colocar el cursor para editarlos.
window.addEventListener("keydown", (event) => {
  if (event.key === "Control" || event.key === "Meta") {
    document.body.classList.add("following-links");
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key === "Control" || event.key === "Meta") {
    document.body.classList.remove("following-links");
  }
});
window.addEventListener("blur", () => document.body.classList.remove("following-links"));

// GitHub, en silencio y en dos tiempos. El catálogo de repositorios es local:
// se lee enseguida y es lo que hace que al reiniciar sigan estando ahí aunque
// no haya red. El estado de la sesión sí sale a la red, así que espera y se
// traga cualquier error; sin conexión el diálogo ya explicará el motivo.
if (isTauri) {
  void connectedRepositories()
    .then((repositories) => {
      repositoryCount = repositories.length;
      paintGithub(lastGithubStatus);
    })
    .catch(() => {});
  window.setTimeout(() => {
    void githubAuthStatus().then(paintGithub).catch(() => {});
  }, 4500);
}
const changelogRaw = localStorage.getItem("unfold:changelog-pending");
if (changelogRaw) {
  try {
    const changelog = JSON.parse(changelogRaw) as { version?: string; notas?: string };
    notify(`Unfold se actualizó a ${changelog.version ?? "la última versión"}${changelog.notas ? ` · ${changelog.notas.split("\n")[0]}` : ""}`);
  } finally { localStorage.removeItem("unfold:changelog-pending"); }
}

window.addEventListener("keydown", (event) => {
  // Escape cierra la apariencia sin necesidad de llegar al aspa.
  if (event.key === "Escape" && settingsOpen) {
    event.preventDefault();
    toggleSettings(false);
    return;
  }

  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key.toLowerCase();

  // Los navegadores reservan estos atajos para ampliar toda la interfaz. En
  // Unfold sólo cambia el documento: el cromo conserva su tamaño y el control
  // de Apariencia permanece sincronizado. `=` cubre Ctrl+=, que es la forma
  // de escribir Ctrl++ en muchos teclados sin que Shift llegue como `+`.
  // AltGr se presenta como Ctrl+Alt en algunos teclados; no debe convertirse
  // accidentalmente en zoom al escribir un símbolo.
  const zoomIn =
    !event.altKey &&
    (event.key === "+" || event.key === "=" || event.code === "NumpadAdd");
  const zoomOut = !event.altKey && (event.key === "-" || event.code === "NumpadSubtract");
  if (zoomIn || zoomOut) {
    event.preventDefault();
    const fontSize = settingsPanel.zoomContent(zoomIn ? 1 : -1);
    notify(`Tamaño del texto: ${fontSize} px`);
    return;
  }

  if (event.key === ",") {
    event.preventDefault();
    toggleSettings();
    return;
  }

  if (key === "b" && event.shiftKey) {
    // No Ctrl+Shift+R: WebView2 conserva sus aceleradores de navegador y ese
    // recargaría la ventana entera.
    event.preventDefault();
    toggleRepositories();
  } else if (key === "o" && event.shiftKey) {
    event.preventDefault();
    toggleOutline();
  } else if (key === "o") {
    event.preventDefault();
    void load();
  } else if (key === "n") {
    event.preventDefault();
    newDocument();
  } else if (key === "w") {
    event.preventDefault();
    void closeTab(tabs.active().id);
  } else if (event.key === "Tab") {
    event.preventDefault();
    const items = tabs.list();
    const index = items.findIndex((tab) => tab.id === tabs.active().id);
    const next = (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
    void switchTab(items[next].id);
  } else if (key === "s") {
    event.preventDefault();
    void persist(event.shiftKey);
  } else if (key === "e" && event.shiftKey) {
    event.preventDefault();
    void exportHtml(exportContext());
  } else if (key === "p") {
    if (event.shiftKey) return;
    // El diálogo del navegador imprimiría el editor, no el documento.
    event.preventDefault();
    printDocument(exportContext());
  } else if (key === "h" && event.shiftKey) {
    // «Hub»: Ctrl+Shift+G ya es «buscar anterior» dentro del editor.
    event.preventDefault();
    showGithub();
  } else if (key === "f" && event.shiftKey) {
    event.preventDefault();
    modos.alternarEnfoque();
  } else if (key === "t" && event.shiftKey) {
    event.preventDefault();
    modos.alternarMaquinaDeEscribir();
  } else if (key === "m" && event.shiftKey) {
    event.preventDefault();
    modos.alternarCodigoFuente();
  } else if (key === "l" && event.shiftKey) {
    // «Localizar». `Ctrl+Shift+F` ya es el modo enfoque desde la primera
    // versión, y cambiarlo ahora rompería la memoria de quien ya lo usa.
    event.preventDefault();
    buscarEnDocumentos();
  } else if (key === "u" && event.shiftKey) {
    // «Subir». Publicar era la única acción de GitHub sin atajo, y es la que
    // se repite: escribir, guardar, publicar, y otra vez.
    event.preventDefault();
    publishCurrent();
  }
});
