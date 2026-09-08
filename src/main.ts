import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import {
  createEditor,
  createEditorState,
  replaceDocument,
  setSourceMode,
  setTypewriter,
  type EditorOptions,
} from "./editor/index.ts";
import { exportHtml, printDocument, type ExportContext } from "./export/index.ts";
import {
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
import { confirmDialog } from "./ui/confirmDialog.ts";
import { RecentMenu } from "./ui/recentMenu.ts";
import { TabBar } from "./ui/tabBar.ts";
import { icon } from "./ui/icons.ts";
import { Outline } from "./ui/outline.ts";
import { SettingsPanel } from "./ui/settings.ts";
import { mountWindowControls } from "./ui/windowControls.ts";
import {
  buscarActualizacion,
  instalarActualizacion,
  omitirVersion,
  restablecerVersionOmitida,
} from "./updates.ts";
import { FileWatcher } from "./watcher.ts";
import { closeMarkdownMenu, openMarkdownMenu } from "./ui/markdownMenu.ts";
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
let autosaveTimer: number | undefined;
let sessionSaveTimer: number | undefined;
/** La guía inicial se descarta al abrir el primer archivo si no se editó. */
let welcomeTabId: number | null = null;
let sourceMode = localStorage.getItem("unfold:source-mode") === "on";
/** Contenido externo pendiente de resolver mientras hay conflicto. */
let conflictContent: string | null = null;

// --- Construcción de la interfaz ---------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="titlebar" data-tauri-drag-region>
    <button class="icon-button titlebar-panel" id="btn-outline" title="Esquema (Ctrl+Shift+O)">${icon("panel")}</button>
    <div class="titlebar-file">
      <span class="titlebar-icon">${icon("file")}</span>
      <span class="titlebar-name" id="doc-name">Sin título</span>
      <span class="titlebar-status" id="doc-status"></span>
    </div>
    <div class="titlebar-actions">
      <button class="icon-button" id="btn-recent" title="Recientes">${icon("clock")}</button>
      <button class="icon-button" id="btn-open" title="Abrir (Ctrl+O)">${icon("open")}</button>
      <button class="icon-button" id="btn-save" title="Guardar (Ctrl+S)">${icon("save")}</button>
      <button class="icon-button" id="btn-search" title="Buscar (Ctrl+F)">${icon("search")}</button>
      <button class="icon-button" id="btn-export" title="Exportar a HTML (Ctrl+Shift+E)">${icon("export")}</button>
      <button class="icon-button" id="btn-print" title="Imprimir o guardar en PDF (Ctrl+P)">${icon("print")}</button>
      <button class="icon-button" id="btn-typewriter" title="Modo máquina de escribir (Ctrl+Shift+T)">${icon("typewriter")}</button>
      <button class="icon-button" id="btn-source" title="Código fuente">${icon("code")}</button>
      <button class="icon-button" id="btn-focus" title="Modo enfoque (Ctrl+Shift+F)">${icon("focus")}</button>
      <button class="icon-button" id="btn-theme" title="Cambiar tema">${icon("moon")}</button>
      <button class="icon-button" id="btn-settings" title="Apariencia (Ctrl+,)">${icon("sliders")}</button>
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
  settings: document.querySelector<HTMLElement>("#settings")!,
  settingsButton: document.querySelector<HTMLButtonElement>("#btn-settings")!,
  recentButton: document.querySelector<HTMLButtonElement>("#btn-recent")!,
  tabBar: document.querySelector<HTMLElement>("#tab-bar")!,
  titlebarFile: document.querySelector<HTMLElement>(".titlebar-file")!,
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
  // Con pestañas visibles, el nombre ya está en la pestaña activa: repetirlo
  // en la barra de título sería ruido.
  el.titlebarFile.classList.toggle("is-hidden", tabs.count() > 1);
  el.name.textContent = session.name;
  el.status.textContent = session.dirty ? "sin guardar" : session.path ? "guardado" : "";
  el.status.classList.toggle("is-dirty", session.dirty);
}

function renderStats(doc: string): void {
  const words = doc.trim() ? doc.trim().split(/\s+/).length : 0;
  el.words.textContent = `${words.toLocaleString("es")} ${words === 1 ? "palabra" : "palabras"}`;
  el.chars.textContent = `${doc.length.toLocaleString("es")} caracteres`;
  el.read.textContent = `${Math.max(1, Math.round(words / 200))} min de lectura`;
}

/** Guarda pestañas, borradores y posición sin escribir los archivos del usuario. */
function saveCurrentSession(): void {
  const snapshot = tabs.snapshot(view, welcomeTabId ?? undefined);
  if (snapshot.tabs.length === 0) clearSession();
  else saveSession(snapshot);
}

function scheduleSessionSave(): void {
  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(saveCurrentSession, 250);
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
    conflictContent = content;
    el.conflict.hidden = false;
    // Mientras haya conflicto no autoguardamos: sobrescribiría el disco.
    window.clearTimeout(autosaveTimer);
  },
  onRemoved: () => notify("El archivo ya no está donde estaba"),
});

function resolveConflict(keepMine: boolean): void {
  if (!keepMine && conflictContent !== null) {
    replaceDocument(view, conflictContent);
    session.dirty = false;
    renderStats(conflictContent);
  }
  conflictContent = null;
  el.conflict.hidden = true;
  renderHeader();
  view.focus();
}

// --- Acciones -----------------------------------------------------------------

function scheduleAutosave(): void {
  window.clearTimeout(autosaveTimer);
  if (!session.path || conflictContent !== null) return;
  // Guardado silencioso un segundo después de dejar de escribir.
  autosaveTimer = window.setTimeout(() => void persist(false), 1000);
}

async function persist(prompt: boolean): Promise<void> {
  const content = view.state.doc.toString();
  watcher.noteSelfWrite();
  const target = prompt ? await saveFileAs(content) : await saveFile(session.path, content);
  if (!target && !session.path) return;
  if (target) {
    session.path = target;
    session.name = target.split(/[\\/]/).pop() ?? target;
    void watcher.watch(target);
  }
  session.dirty = false;
  renderHeader();
  scheduleSessionSave();
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
  const doc = view.state.doc.toString();
  renderHeader();
  renderStats(doc);
  outline.refresh();
  // El modo máquina de escribir vive en un compartimento del estado, y el
  // estado nuevo trae el suyo vacío: hay que reponerlo en cada cambio.
  applyTypewriter();
  applySourceMode();
  scheduleSessionSave();
  void watcher.watch(session.path);
  view.focus();
}

async function load(): Promise<void> {
  if (!(await confirmDiscard("abrir otro"))) return;
  const file = await openFile();
  if (file) applyFile(file);
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
    await persist(false);
    return true;
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
    await persist(false);
    // Si el diálogo de guardar se cerró sin elegir sitio, no se sigue.
    return !session.dirty;
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
  if (session.dirty && session.path && conflictContent === null) await persist(false);
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
    if (!(await confirmDiscard("cerrar la pestaña"))) return;
  }

  tabs.close(view, id);
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

function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  localStorage.setItem("unfold:theme", next);
  el.theme.innerHTML = icon(next === "dark" ? "sun" : "moon");
}

function toggleFocusMode(): void {
  document.body.classList.toggle("focus-mode");
}

let typewriterOn = localStorage.getItem("unfold:typewriter") === "on";

function applyTypewriter(): void {
  setTypewriter(view, typewriterOn);
  el.typewriter.classList.toggle("is-on", typewriterOn);
  document.body.classList.toggle("typewriter-mode", typewriterOn);
}

function applySourceMode(): void {
  setSourceMode(view, sourceMode);
  el.source.classList.toggle("is-on", sourceMode);
  el.source.title = sourceMode ? "Vista renderizada" : "Código fuente";
  document.body.classList.toggle("source-mode", sourceMode);
}

function toggleSourceMode(): void {
  sourceMode = !sourceMode;
  localStorage.setItem("unfold:source-mode", sourceMode ? "on" : "off");
  applySourceMode();
  view.focus();
}

function toggleTypewriter(): void {
  typewriterOn = !typewriterOn;
  localStorage.setItem("unfold:typewriter", typewriterOn ? "on" : "off");
  applyTypewriter();
  view.focus();
}

let settingsPanel: SettingsPanel;
let settingsOpen = false;

function toggleSettings(force?: boolean): void {
  settingsOpen = force ?? !settingsOpen;
  settingsPanel.setOpen(settingsOpen);
  el.settingsButton.classList.toggle("is-on", settingsOpen);
  if (!settingsOpen) view.focus();
}

let outlineOn = localStorage.getItem("unfold:outline") === "on";

function applyOutline(): void {
  outline.setCollapsed(!outlineOn);
  el.outlineButton.classList.toggle("is-on", outlineOn);
  if (outlineOn) outline.refresh();
}

function toggleOutline(): void {
  outlineOn = !outlineOn;
  localStorage.setItem("unfold:outline", outlineOn ? "on" : "off");
  applyOutline();
  view.focus();
}

// --- Arranque -----------------------------------------------------------------

// Recién instalado se arranca en claro, no en lo que diga el sistema: es el
// aspecto con el que se diseñó el editor y el que se quiere enseñar primero.
// A partir de ahí manda lo que el usuario haya elegido.
const savedTheme = localStorage.getItem("unfold:theme");
document.documentElement.dataset.theme = savedTheme ?? "light";
el.theme.innerHTML = icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon");

const initialDocument = takeWelcome();

const editorOptions: EditorOptions = {
  parent: el.host,
  doc: initialDocument,
  resolveAsset: makeAssetResolver(() => session.path),
  onSelection: (line, column) => {
    el.caret.textContent = `Ln ${line}, Col ${column}`;
    if (outlineOn) outline.refresh();
    scheduleSessionSave();
  },
  onChange: (doc) => {
    // La guía inicial deja de ser efímera en cuanto el usuario la edita.
    if (welcomeTabId !== null && tabs.active().id === welcomeTabId) welcomeTabId = null;
    session.dirty = true;
    if (!session.path) session.name = titleFromDoc(doc);
    renderHeader();
    renderStats(doc);
    scheduleAutosave();
    if (outlineOn) outline.refresh();
    scheduleSessionSave();
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
mountWindowControls(document.querySelector<HTMLElement>("#window-controls")!);
settingsPanel = new SettingsPanel(el.settings, () => toggleSettings(false), {
  check: () => checkForUpdates(true),
  resetDismissed: () => {
    restablecerVersionOmitida();
    checkForUpdates(true);
  },
});

renderHeader();
renderStats(initialDocument);
applyTypewriter();
applySourceMode();
applyOutline();
view.focus();

async function restoreSession(): Promise<void> {
  const saved = loadSession();
  if (!saved) return;

  // Los archivos limpios se leen de nuevo desde disco; los sucios conservan
  // el borrador local para no perder cambios que aún no llegaron al archivo.
  const snapshots = [];
  for (const snapshot of saved.tabs) {
    if (snapshot.path && !snapshot.dirty) {
      try {
        snapshot.content = await readFile(snapshot.path);
      } catch {
        continue;
      }
    }
    snapshots.push(snapshot);
  }
  if (snapshots.length === 0) {
    clearSession();
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
document.querySelector("#btn-focus")!.addEventListener("click", toggleFocusMode);
el.outlineButton.addEventListener("click", toggleOutline);
el.typewriter.addEventListener("click", toggleTypewriter);
el.source.addEventListener("click", toggleSourceMode);
el.theme.addEventListener("click", toggleTheme);
el.settingsButton.addEventListener("click", () => toggleSettings());
el.recentButton.addEventListener("click", () => recentMenu.toggle());
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
  openMarkdownMenu(event, view, sourceMode, toggleSourceMode, chooseImage);
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
        if (!(await confirmDiscard("cerrar"))) return;
        // Si se descartó, la pestaña sigue marcada como sucia: se limpia para
        // no volver a preguntar por ella en la siguiente vuelta.
        pending.dirty = false;
        saveCurrentSession();
      }

      closing = true;
      saveCurrentSession();
      await appWindow.destroy();
    });

    const startup = await invoke<string | null>("startup_file");
    if (startup) await loadPath(startup);
    else await restoreSession();

    await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const dropped = event.payload.paths.find((path) => /\.(md|markdown|mdx|txt)$/i.test(path));
      if (dropped) void loadPath(dropped);
    });
  })();
} else {
  void restoreSession();
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

// --- Actualizaciones ----------------------------------------------------------

let versionNueva = "";
let estadoUpdate: "idle" | "available" | "checking" | "installing" | "error" = "idle";

const manejadoresUpdate = {
  onAvailable: (version: string, notas: string) => {
    estadoUpdate = "available";
    el.update.classList.remove("is-error");
    versionNueva = version;
    const resumen = notas.split("\n")[0]?.trim();
    el.updateText.textContent = resumen
      ? `Versión ${version} disponible · ${resumen}`
      : `Versión ${version} disponible`;
    el.updateNow.textContent = "Actualizar";
    el.updateNow.hidden = false;
    el.updateLater.textContent = "Más tarde";
    el.updateLater.hidden = false;
    el.updateNow.disabled = false;
    el.update.hidden = false;
  },
  onProgress: (descargado: number, total: number | null) => {
    estadoUpdate = "installing";
    el.update.classList.remove("is-error");
    const megas = (descargado / 1024 / 1024).toFixed(1);
    el.updateText.textContent = total
      ? `Descargando ${megas} de ${(total / 1024 / 1024).toFixed(1)} MB…`
      : `Descargando ${megas} MB…`;
  },
  onError: (mensaje: string) => {
    estadoUpdate = "error";
    el.update.classList.add("is-error");
    console.error("Fallo al actualizar", mensaje);
    el.updateText.textContent = mensaje;
    el.updateNow.textContent = "Reintentar";
    el.updateNow.hidden = false;
    el.updateNow.disabled = false;
    el.updateLater.textContent = "Cerrar";
    el.updateLater.hidden = false;
    el.update.hidden = false;
  },
};

function checkForUpdates(force = false): void {
  estadoUpdate = "checking";
  el.update.classList.remove("is-error");
  el.updateText.textContent = "Buscando actualizaciones…";
  el.updateNow.hidden = true;
  el.updateLater.textContent = "Cancelar";
  el.updateLater.hidden = false;
  el.update.hidden = false;
  void buscarActualizacion(manejadoresUpdate, force).then((found) => {
    if (!found && estadoUpdate === "checking") {
      estadoUpdate = "idle";
      el.update.hidden = true;
      notify("No hay actualizaciones disponibles.");
    }
  });
}

el.updateNow.addEventListener("click", () => {
  if (estadoUpdate === "error") {
    checkForUpdates(true);
    return;
  }
  if (estadoUpdate !== "available") return;
  estadoUpdate = "installing";
  el.updateNow.disabled = true;
  el.updateLater.hidden = true;
  void instalarActualizacion(manejadoresUpdate);
});

el.updateLater.addEventListener("click", () => {
  if (estadoUpdate === "available" && versionNueva) omitirVersion(versionNueva);
  estadoUpdate = "idle";
  el.update.hidden = true;
});

// Se consulta con retraso: la red no debe frenar el arranque del editor.
window.setTimeout(() => void buscarActualizacion(manejadoresUpdate), 4000);

window.addEventListener("keydown", (event) => {
  // Escape cierra la apariencia sin necesidad de llegar al aspa.
  if (event.key === "Escape" && settingsOpen) {
    event.preventDefault();
    toggleSettings(false);
    return;
  }

  if (!event.ctrlKey && !event.metaKey) return;
  const key = event.key.toLowerCase();

  if (event.key === ",") {
    event.preventDefault();
    toggleSettings();
    return;
  }

  if (key === "o" && event.shiftKey) {
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
    tabs.cycle(view, event.shiftKey ? -1 : 1);
    afterTabChange();
  } else if (key === "s") {
    event.preventDefault();
    void persist(event.shiftKey);
  } else if (key === "e" && event.shiftKey) {
    event.preventDefault();
    void exportHtml(exportContext());
  } else if (key === "p") {
    // El diálogo del navegador imprimiría el editor, no el documento.
    event.preventDefault();
    printDocument(exportContext());
  } else if (key === "f" && event.shiftKey) {
    event.preventDefault();
    toggleFocusMode();
  } else if (key === "t" && event.shiftKey) {
    event.preventDefault();
    toggleTypewriter();
  } else if (key === "m" && event.shiftKey) {
    event.preventDefault();
    toggleSourceMode();
  }
});
