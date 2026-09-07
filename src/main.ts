import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { createEditor, replaceDocument, setTypewriter } from "./editor/index.ts";
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
import { confirmDialog } from "./ui/confirmDialog.ts";
import { icon } from "./ui/icons.ts";
import { Outline } from "./ui/outline.ts";
import { SettingsPanel } from "./ui/settings.ts";
import { mountWindowControls } from "./ui/windowControls.ts";
import { FileWatcher } from "./watcher.ts";
import "./styles/app.css";
import "./styles/markdown.css";

const WELCOME = `# Unfold

Un editor Markdown que se ve como el documento final **mientras escribes**.

Coloca el cursor en cualquier línea y la sintaxis reaparece para editarla.
Sácalo de ahí y vuelve a *renderizarse*.

## Lo que ya funciona

- Vista previa en vivo: encabezados, **negrita**, *cursiva*, ~~tachado~~ y \`código\`
- Listas de tareas que puedes marcar con el ratón
  - [x] Ocultar los marcadores de sintaxis
  - [x] Tablas renderizadas y navegables con \`Tab\`
  - [x] Esquema lateral, exportación y vigilancia del archivo
- Citas, reglas horizontales e imágenes en línea
- Bloques de código con resaltado por lenguaje

> El archivo en disco sigue siendo Markdown puro. Nada se reescribe al guardar.

---

## Atajos

| Acción | Atajo |
| --- | --- |
| Nuevo / Abrir / Guardar | \`Ctrl+N\` / \`Ctrl+O\` / \`Ctrl+S\` |
| Negrita / Cursiva | \`Ctrl+B\` / \`Ctrl+I\` |
| Encabezado 1..6 | \`Ctrl+1\` … \`Ctrl+6\` |
| Buscar | \`Ctrl+F\` |
| Esquema | \`Ctrl+Shift+O\` |
| Exportar HTML / Imprimir | \`Ctrl+Shift+E\` / \`Ctrl+P\` |
| Seguir un enlace | \`Ctrl\` + clic |

\`\`\`ts
// El resaltado de código va por lenguaje, cargado bajo demanda.
const saludo = (nombre: string) => \`Hola, \${nombre}\`;
console.log(saludo("Esdras"));
\`\`\`
`;

interface Session {
  path: string | null;
  name: string;
  dirty: boolean;
}

const session: Session = { path: null, name: "Sin título", dirty: false };
let view: EditorView;
let outline: Outline;
let autosaveTimer: number | undefined;
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
      <button class="icon-button" id="btn-open" title="Abrir (Ctrl+O)">${icon("open")}</button>
      <button class="icon-button" id="btn-save" title="Guardar (Ctrl+S)">${icon("save")}</button>
      <button class="icon-button" id="btn-search" title="Buscar (Ctrl+F)">${icon("search")}</button>
      <button class="icon-button" id="btn-export" title="Exportar a HTML (Ctrl+Shift+E)">${icon("export")}</button>
      <button class="icon-button" id="btn-print" title="Imprimir o guardar en PDF (Ctrl+P)">${icon("print")}</button>
      <button class="icon-button" id="btn-typewriter" title="Modo máquina de escribir (Ctrl+Shift+T)">${icon("typewriter")}</button>
      <button class="icon-button" id="btn-focus" title="Modo enfoque (Ctrl+Shift+F)">${icon("focus")}</button>
      <button class="icon-button" id="btn-theme" title="Cambiar tema">${icon("moon")}</button>
      <button class="icon-button" id="btn-settings" title="Apariencia (Ctrl+,)">${icon("sliders")}</button>
    </div>
    <div class="window-controls" id="window-controls"></div>
  </header>
  <div class="conflict-bar" id="conflict" hidden>
    <span class="conflict-text">Este archivo ha cambiado fuera de Unfold y tienes cambios sin guardar.</span>
    <button class="conflict-action" id="conflict-reload">Cargar la versión del disco</button>
    <button class="conflict-action is-quiet" id="conflict-keep">Mantener la mía</button>
  </div>
  <div class="workspace">
    <aside class="outline is-collapsed" id="outline" inert></aside>
    <main class="editor-host" id="editor-host"></main>
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
  outlineButton: document.querySelector<HTMLButtonElement>("#btn-outline")!,
  settings: document.querySelector<HTMLElement>("#settings")!,
  settingsButton: document.querySelector<HTMLButtonElement>("#btn-settings")!,
};

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
  el.status.textContent = session.dirty ? "sin guardar" : "guardado";
  el.status.classList.toggle("is-dirty", session.dirty);
}

function renderStats(doc: string): void {
  const words = doc.trim() ? doc.trim().split(/\s+/).length : 0;
  el.words.textContent = `${words.toLocaleString("es")} ${words === 1 ? "palabra" : "palabras"}`;
  el.chars.textContent = `${doc.length.toLocaleString("es")} caracteres`;
  el.read.textContent = `${Math.max(1, Math.round(words / 200))} min de lectura`;
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
}

function applyFile(file: OpenedFile): void {
  session.path = file.path;
  session.name = file.name;
  session.dirty = false;
  conflictContent = null;
  el.conflict.hidden = true;
  replaceDocument(view, file.content);
  renderHeader();
  renderStats(file.content);
  outline.refresh();
  void watcher.watch(file.path);
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

async function newDocument(): Promise<void> {
  if (!(await confirmDiscard("empezar uno nuevo"))) return;
  watcher.close();
  session.path = null;
  session.name = "Sin título";
  session.dirty = false;
  conflictContent = null;
  el.conflict.hidden = true;
  replaceDocument(view, "");
  renderHeader();
  renderStats("");
  outline.refresh();
  view.focus();
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

view = createEditor({
  parent: el.host,
  doc: WELCOME,
  resolveAsset: makeAssetResolver(() => session.path),
  onSelection: (line, column) => {
    el.caret.textContent = `Ln ${line}, Col ${column}`;
    if (outlineOn) outline.refresh();
  },
  onChange: (doc) => {
    session.dirty = true;
    renderHeader();
    renderStats(doc);
    scheduleAutosave();
    if (outlineOn) outline.refresh();
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
});

outline = new Outline(el.outline, () => view);
mountWindowControls(document.querySelector<HTMLElement>("#window-controls")!);
settingsPanel = new SettingsPanel(el.settings, () => toggleSettings(false));

renderHeader();
renderStats(WELCOME);
applyTypewriter();
applyOutline();
view.focus();

document.querySelector("#btn-open")!.addEventListener("click", () => void load());
document.querySelector("#btn-save")!.addEventListener("click", () => void persist(false));
document.querySelector("#btn-search")!.addEventListener("click", () => openSearchPanel(view));
document.querySelector("#btn-export")!.addEventListener("click", () => void exportHtml(exportContext()));
document.querySelector("#btn-print")!.addEventListener("click", () => printDocument(exportContext()));
document.querySelector("#btn-focus")!.addEventListener("click", toggleFocusMode);
el.outlineButton.addEventListener("click", toggleOutline);
el.typewriter.addEventListener("click", toggleTypewriter);
el.theme.addEventListener("click", toggleTheme);
el.settingsButton.addEventListener("click", () => toggleSettings());

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
      if (await confirmDiscard("cerrar")) {
        closing = true;
        await appWindow.destroy();
      }
    });

    const startup = await invoke<string | null>("startup_file");
    if (startup) await loadPath(startup);

    await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const dropped = event.payload.paths.find((path) => /\.(md|markdown|mdx|txt)$/i.test(path));
      if (dropped) void loadPath(dropped);
    });
  })();
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
    void newDocument();
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
  }
});
