import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { EditorController, type EditorControllerOptions } from "../editor/EditorController.ts";
import { EditorHost } from "../components/editor/EditorHost.tsx";
import { exportHtml, printDocument, type ExportContext } from "../export/index.ts";
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
} from "../files.ts";
import { rememberRecent } from "../recent.ts";
import { clearSession, loadSession, saveSession } from "../session.ts";
import { Tabs } from "../tabs.ts";
import { saveSnapshot } from "../saveSnapshot.ts";
import { confirmDialog } from "../ui/confirmDialog.ts";
import { dialogSnapshot, subscribeDialogs } from "../ui/dialogs.ts";
import { RecentMenu } from "../ui/recentMenu.ts";
import { TabBar, type TabBarProps, type TabBarTab } from "../components/tabs/TabBar.tsx";
import { h, render } from "preact";
import {
  AppShell,
  type AppHosts,
  type AppShellActions,
  type AppShellState,
} from "../components/app/AppShell.tsx";
import { mountComponent, type MountedComponent } from "../components/mountComponent.ts";
import { DocumentTitle, type DocumentTitleProps } from "../components/status/DocumentTitle.tsx";
import { StatusBar, type StatusBarProps } from "../components/status/StatusBar.tsx";
import { Outline } from "../ui/outline.ts";
import { RepositoryPanel } from "../ui/repositoryPanel.ts";
import { SettingsPanel } from "../ui/settings.ts";
import { mountWindowControls } from "../ui/windowControls.ts";
import { restablecerVersionOmitida } from "../updates.ts";
import { mountUpdateBanner } from "../ui/updateBanner.ts";
import { FileWatcher } from "../watcher.ts";
import { closeMarkdownMenu, openMarkdownMenu } from "../ui/markdownMenu.ts";
import { openCommandPalette } from "../ui/commandPalette.ts";
import { paletteCommands, type PaletteActions } from "../ui/paletteCommands.ts";
import { aplicarTemaGuardado, mountViewModes } from "../ui/viewModes.ts";
import { openDocumentSearch } from "../ui/searchDocuments.ts";
import { historyKey, loadHistory, recordVersion } from "../history.ts";
import { migrarDesdeLocalStorage } from "../store.ts";
import { openHistoryDialog } from "../ui/historyDialog.ts";
import type { GithubAuthStatus } from "../github.ts";
import {
  createRepositoryDocumentFile,
  type ConnectedRepository,
} from "../repositories.ts";
import { chooseFolder, folderCreateDocument, isFolder, openFolder } from "../folders.ts";
import { backupFolder, createBackup, limpiarIndiceViejo, restoreLatest, setBackupFolder } from "../backups.ts";
import { takeWelcome } from "../welcome.ts";
import "../styles/app.css";
import "../styles/markdown.css";
import { registerCommands } from "./commands.ts";
import { registerDesktopIntegration } from "./desktopIntegration.ts";
import { startGithubController } from "./GithubController.ts";

export async function bootstrap(root: HTMLElement): Promise<void> {

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

let view!: EditorView;
let tabs: Tabs;
let tabBar: MountedComponent<TabBarProps>;
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

/**
 * El estado del que depende el aspecto del armazón.
 *
 * Se guarda entero porque cada repintado lo necesita entero: el botón del tema
 * no sabe si el esquema está abierto, ni el aviso de conflicto sabe qué modo
 * está puesto.
 */
let shell: AppShellState = {
  theme: aplicarTemaGuardado(),
  sourceMode: localStorage.getItem("unfold:source-mode") === "on",
  typewriter: localStorage.getItem("unfold:typewriter") === "on",
  focusMode: false,
  outline: localStorage.getItem("unfold:outline") === "on",
  repositories: localStorage.getItem("unfold:repositories") === "on",
  settings: false,
  recent: false,
  githubActive: false,
  githubTitle: "GitHub (Ctrl+Shift+H)",
  updatePending: null,
  conflict: false,
  dialogs: dialogSnapshot(),
};

const hosts: AppHosts = {
  titlebarFile: null,
  recentButton: null,
  windowControls: null,
  update: null,
  repositories: null,
  outline: null,
  tabBar: null,
  editorHost: null,
  settings: null,
  statusbar: null,
};

const shellActions: AppShellActions = {
  onOutline: () => toggleOutline(),
  onRepositories: () => toggleRepositories(),
  onRecent: () => recentMenu.toggle(),
  onOpen: () => void load(),
  onSave: () => void persist(false),
  onSearch: () => openSearchPanel(view),
  onGithub: () => showGithub(),
  onExport: () => void exportHtml(exportContext()),
  onPrint: () => printDocument(exportContext()),
  onSource: () => modos.alternarCodigoFuente(),
  onFocus: () => modos.alternarEnfoque(),
  onTypewriter: () => modos.alternarMaquinaDeEscribir(),
  onTheme: () => modos.alternarTema(),
  onSettings: () => toggleSettings(),
  onReloadFromDisk: () => resolveConflict(false),
  onKeepMine: () => resolveConflict(true),
};

const app = root;

function pintarShell(cambio: Partial<AppShellState> = {}): void {
  shell = { ...shell, ...cambio };
  render(h(AppShell, { state: shell, actions: shellActions, hosts }), app);
}

pintarShell();
const unsubscribeDialogs = subscribeDialogs((dialogs) => pintarShell({ dialogs }));

// Ya pintado el armazón, sus huecos existen: las referencias las puso Preact al
// montarlos, así que nadie los busca por identificador.
const el = hosts as { [K in keyof AppHosts]: HTMLElement };

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

/**
 * Estado visible del documento y de la barra de estado.
 *
 * Los dos componentes son de Preact y se pintan desde aquí, que sigue siendo
 * quien sabe cuándo cambia algo. Se guarda lo último enseñado porque cada
 * repintado necesita el estado entero: el recuento no sabe dónde está el
 * cursor, y el cursor no sabe cuántas palabras hay.
 */
let vistaTitulo: DocumentTitleProps = { name: "Sin título", notice: null, dirty: false, saved: false };
let vistaEstado: StatusBarProps = { doc: "", line: 1, column: 1 };

function pintarTitulo(cambio: Partial<DocumentTitleProps> = {}): void {
  vistaTitulo = { ...vistaTitulo, ...cambio };
  documentTitle.update(vistaTitulo);
}

function pintarEstado(cambio: Partial<StatusBarProps> = {}): void {
  vistaEstado = { ...vistaEstado, ...cambio };
  statusBar.update(vistaEstado);
}

/** Aviso breve en la barra de título; se borra solo. */
const documentTitle = mountComponent<DocumentTitleProps>(el.titlebarFile, DocumentTitle, {
  name: "Sin título",
  notice: null,
  dirty: false,
  saved: false,
});
const statusBar = mountComponent<StatusBarProps>(el.statusbar, StatusBar, { doc: "", line: 1, column: 1 });

let noticeTimer: number | undefined;
function notify(message: string): void {
  window.clearTimeout(noticeTimer);
  pintarTitulo({ notice: message });
  noticeTimer = window.setTimeout(() => pintarTitulo({ notice: null }), 3000);
}

// --- Estado visible -----------------------------------------------------------

function renderHeader(): void {
  pintarTitulo({ name: session.name, dirty: session.dirty, saved: session.path !== null });
}

function renderStats(doc: string): void {
  pintarEstado({ doc });
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
    editorController.replaceDocument(content);
    session.dirty = false;
    renderHeader();
    renderStats(content);
    notify("Recargado: el archivo cambió fuera de Unfold");
  },
  onConflict: (content) => {
    tabConflicts.set(tabs.active().id, content);
    conflictContent = content;
    pintarShell({ conflict: true });
    // Mientras haya conflicto no autoguardamos: sobrescribiría el disco.
    window.clearTimeout(autosaveTimer);
  },
  onRemoved: () => notify("El archivo ya no está donde estaba"),
});

function resolveConflict(keepMine: boolean): void {
  tabConflicts.delete(tabs.active().id);
  if (!keepMine && conflictContent !== null) {
    editorController.replaceDocument(conflictContent);
    session.dirty = false;
    renderStats(conflictContent);
  }
  conflictContent = null;
  pintarShell({ conflict: false });
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
      pintarShell({ conflict: false });
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
  pintarShell({ conflict: false });
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
  pintarShell({ conflict: conflictContent !== null });
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
  pintarShell({ conflict: false });
  tabs.create(view);
  afterTabChange();
}

async function switchTab(id: number): Promise<void> {
  if (id === tabs.active().id) return;
  // Se guarda lo pendiente de la que se abandona: al volver debe estar como
  // se dejó, y el autoguardado de la otra ya no se dispararía.
  if (session.dirty && session.path && conflictContent === null && !(await persist(false))) return;
  conflictContent = null;
  pintarShell({ conflict: false });
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
  pintarShell({ conflict: false });
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
  if (settingsOpen) settingsPanel.setUpdatePending(actualizaciones.pendiente());
  pintarShell({ settings: settingsOpen });
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
  const account = status.connected ? ` · @${status.user?.login ?? ""}` : "";
  const repositories =
    repositoryCount === 1 ? " · 1 repositorio" : repositoryCount > 1 ? ` · ${repositoryCount} repositorios` : "";
  pintarShell({
    githubActive: status.connected || repositoryCount > 0,
    githubTitle: `GitHub${account}${repositories} (Ctrl+Shift+H)`,
  });
  repositoryPanel?.setAccount(status);
}

function showCommit(repository: ConnectedRepository): void {
  void import("../ui/commitDialog.ts").then(({ openCommitDialog }) => {
    openCommitDialog(repository, {
      onChanged: () => void repositoryPanel.refreshRepository(repository.id, true),
      notify,
    });
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
  void import("../ui/githubDialog.ts").then(({ openGithubDialog }) => openGithubDialog({
    onStatusChange: paintGithub,
    // Un documento del repositorio es un archivo normal del disco: se abre
    // como cualquier otro y hereda pestañas, sesión y recientes sin nada más.
    onOpenDocument: (path) => void loadPath(path),
    onRepositoriesChange: (count) => {
      repositoryCount = count;
      paintGithub(lastGithubStatus);
      if (repositoriesOn) void repositoryPanel.refresh();
    },
  }));
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
  pintarShell({ outline: outlineOn, repositories: repositoriesOn });
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

const initialDocument = takeWelcome();

const editorOptions: EditorControllerOptions = {
  resolveAsset: makeAssetResolver(() => session.path),
  onSelection: (line, column) => {
    pintarEstado({ line, column });
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

const editorController = new EditorController(editorOptions);
render(
  h(EditorHost, {
    controller: editorController,
    doc: initialDocument,
    onReady: (editor) => { view = editor; },
  }),
  el.editorHost,
);
const modos = mountViewModes(view, (estado) => pintarShell(estado));

const pintarPestanas = (): void =>
  tabBar.update({
    tabs: tabs.list().map(
      (tab): TabBarTab => ({ id: tab.id, name: tab.name, path: tab.path, dirty: tab.dirty }),
    ),
    activeId: tabs.active().id,
    onActivate: (id) => void switchTab(id),
    onClose: (id) => void closeTab(id),
  });

tabs = new Tabs((doc) => editorController.createState(doc), () => pintarPestanas());
tabBar = mountComponent<TabBarProps>(el.tabBar, TabBar, {
  tabs: [],
  activeId: 0,
  onActivate: (id: number) => void switchTab(id),
  onClose: (id: number) => void closeTab(id),
});
const initialTab = tabs.adopt(view.state, titleFromDoc(initialDocument));
if (initialDocument) welcomeTabId = initialTab.id;

recentMenu = new RecentMenu(el.recentButton, {
  open: (path) => void loadPath(path),
  browse: () => void load(),
  onOpenChange: (recent) => pintarShell({ recent }),
});

outline = new Outline(el.outline, () => view);
repositoryPanel = new RepositoryPanel(el.repositories, {
  onOpen: (path) => void loadPath(path),
  onManage: showGithub,
  onPublish: showCommit,
  onCreate: (repository) => void createRepositoryDocument(repository),
  onAddFolder: () => void addFolder(),
});
window.addEventListener("beforeunload", () => {
  unsubscribeDialogs();
  repositoryPanel.dispose();
});
mountWindowControls(el.windowControls);
const actualizaciones = mountUpdateBanner(el.update, {
  notify,
  guardarSesion: saveCurrentSession,
  // Un punto en el botón de ajustes mientras haya algo pendiente: apartar la
  // tarjeta no puede ser lo mismo que perder el aviso.
  marcarPendiente: (version) => {
    pintarShell({ updatePending: version });
    settingsPanel?.setUpdatePending(version);
  },
});
settingsPanel = new SettingsPanel(el.settings, () => toggleSettings(false), {
  check: () => actualizaciones.comprobar(true),
  install: () => actualizaciones.mostrar(),
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
  editorController.replaceDocument(content);
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
      editorController.replaceDocument(content),
    ),
  configurarCarpetaCopias: () => void configurarCarpetaCopias(),
  recuperarCopia: () => void recuperarCopia(),
  enCodigoFuente: modos.enCodigoFuente,
  carpetaCopias: backupFolder,
};

const unregisterCommands = registerCommands({
  closeSettings: () => { if (settingsOpen) toggleSettings(false); },
  zoom: (direction) => {
    const fontSize = settingsPanel.zoomContent(direction);
    notify(`TamaÃ±o del texto: ${fontSize} px`);
  },
  toggleRepositories,
  toggleOutline,
  open: () => void load(),
  create: newDocument,
  close: () => void closeTab(tabs.active().id),
  cycle: (direction) => {
    const items = tabs.list();
    if (items.length < 2) return;
    const index = items.findIndex((tab) => tab.id === tabs.active().id);
    void switchTab(items[(index + direction + items.length) % items.length].id);
  },
  save: (saveAs) => void persist(saveAs),
  export: () => void exportHtml(exportContext()),
  print: () => printDocument(exportContext()),
  github: showGithub,
  focus: modos.alternarEnfoque,
  typewriter: modos.alternarMaquinaDeEscribir,
  source: modos.alternarCodigoFuente,
  search: buscarEnDocumentos,
  publish: publishCurrent,
  palette: () => openCommandPalette(paletteCommands(accionesPaleta)),
});

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
  /*
   * Con Shift se deja pasar el menú del sistema.
   *
   * El corrector de WebView2 está pedido desde el principio, así que las
   * palabras mal escritas ya salen subrayadas. Pero las sugerencias sólo viven
   * en el menú nativo —una página no puede leerlas—, y este menú propio lo
   * tapaba siempre: se veía el subrayado y no había forma de corregir.
   */
  if (event.shiftKey) return;
  openMarkdownMenu(event, view, modos.enCodigoFuente(), modos.alternarCodigoFuente, chooseImage);
});
window.addEventListener("resize", closeMarkdownMenu);

void registerDesktopIntegration({
  initialize: prepararEstado,
  startupFile: async (startup) => {
    if (startup) await loadPath(startup);
    else await restoreSession();
  },
  openFile: (path) => void loadPath(path),
  beforeClose: async () => {
    while (tabs.dirtyTabs().length > 0) {
      const pending = tabs.dirtyTabs()[0];
      await switchTab(pending.id);
      if (tabs.active().id !== pending.id) return false;
      if (!(await confirmDiscard("cerrar"))) return false;
      pending.dirty = false;
      void saveCurrentSession();
    }
    await saveCurrentSession();
    return true;
  },
}).catch((error) => console.error("No se pudo inicializar la integración de escritorio", error));

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

const stopGithubController = startGithubController({
  onRepositories: (count) => {
    repositoryCount = count;
    paintGithub(lastGithubStatus);
  },
  onStatus: paintGithub,
});
window.addEventListener("beforeunload", stopGithubController);

const changelogRaw = localStorage.getItem("unfold:changelog-pending");
if (changelogRaw) {
  try {
    const changelog = JSON.parse(changelogRaw) as { version?: string; notas?: string };
    notify(`Unfold se actualizó a ${changelog.version ?? "la última versión"}${changelog.notas ? ` · ${changelog.notas.split("\n")[0]}` : ""}`);
  } finally { localStorage.removeItem("unfold:changelog-pending"); }
}

window.addEventListener("beforeunload", unregisterCommands);
}
