import type { StateCommand } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  insertCodeFence,
  insertLink,
  insertMarkdownBlock,
  insertMarkdownSnippet,
  setHeading,
  toggleBold,
  toggleItalic,
  toggleLinePrefix,
  toggleTask,
  toggleInlineCode,
  toggleStrikethrough,
} from "../editor/commands.ts";

interface MenuItem {
  label: string;
  shortcut?: string;
  command?: (view: EditorView) => boolean;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const run = (command: StateCommand) => (view: EditorView): boolean =>
  command({ state: view.state, dispatch: (transaction) => view.dispatch(transaction) });

/** Menú contextual con las construcciones que Unfold puede renderizar. */
export function openMarkdownMenu(
  event: MouseEvent,
  view: EditorView,
  sourceMode: boolean,
  onSourceMode: () => void,
  onChooseImage?: () => void,
): void {
  event.preventDefault();
  closeMarkdownMenu();

  const menu = document.createElement("div");
  menu.className = "menu markdown-menu";
  menu.setAttribute("role", "menu");
  const groups: MenuGroup[] = [
    {
      label: "Formato",
      items: [
        { label: "Negrita", shortcut: "Ctrl+B", command: run(toggleBold) },
        { label: "Cursiva", shortcut: "Ctrl+I", command: run(toggleItalic) },
        { label: "Código en línea", shortcut: "Ctrl+E", command: run(toggleInlineCode) },
        { label: "Tachado", shortcut: "Ctrl+Shift+X", command: run(toggleStrikethrough) },
        { label: "Enlace", shortcut: "Ctrl+K", command: run(insertLink) },
      ],
    },
    {
      label: "Párrafo",
      items: [
        ...[1, 2, 3, 4, 5, 6].map((level) => ({
          label: `Título ${level}`,
          shortcut: `Ctrl+${level}`,
          command: run(setHeading(level)),
        })),
        { label: "Párrafo normal", shortcut: "Ctrl+0", command: run(setHeading(0)) },
        { label: "Cita", command: run(toggleLinePrefix("> ")) },
        { label: "Lista con viñetas", command: run(toggleLinePrefix("- ")) },
        { label: "Lista numerada", command: run(toggleLinePrefix("1. ")) },
        { label: "Lista de tareas", command: run(toggleTask) },
      ],
    },
    {
      label: "Bloques",
      items: [
        { label: "Bloque de código", command: run(insertCodeFence) },
        { label: "Regla horizontal", command: run(insertMarkdownBlock("---")) },
        { label: "Tabla", command: run(insertMarkdownBlock("| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |", 46)) },
        { label: "Fórmula en línea", command: run(insertMarkdownSnippet("$fórmula$", 1)) },
        { label: "Fórmula de bloque", command: run(insertMarkdownBlock("$$\n\n$$", 3)) },
        { label: "Frontmatter YAML", command: run(insertMarkdownBlock("---\ntitle: \nauthor: \n---\n", 15)) },
        { label: "Imagen", command: onChooseImage ? () => { onChooseImage(); return true; } : run(insertMarkdownSnippet("![descripción](/ruta/a/imagen.png)", 16)) },
      ],
    },
  ];

  for (const group of groups) {
    const heading = document.createElement("div");
    heading.className = "menu-head";
    heading.textContent = group.label;
    menu.append(heading);
    for (const item of group.items) {
      const button = document.createElement("button");
      button.className = "menu-item markdown-menu-item";
      button.type = "button";
      button.setAttribute("role", "menuitem");
      const name = document.createElement("span");
      name.className = "menu-item-name";
      name.textContent = item.label;
      button.append(name);
      if (item.shortcut) {
        const meta = document.createElement("span");
        meta.className = "menu-item-meta";
        meta.textContent = item.shortcut;
        button.append(meta);
      }
      button.addEventListener("click", () => {
        if (item.command) item.command(view);
        closeMarkdownMenu();
        view.focus();
      });
      menu.append(button);
    }
  }

  const mode = document.createElement("button");
  mode.className = "menu-item markdown-menu-mode";
  mode.type = "button";
  mode.textContent = sourceMode ? "✓ Vista renderizada" : "Código fuente";
  mode.title = "Alternar con Ctrl+Shift+M";
  mode.addEventListener("click", () => {
    closeMarkdownMenu();
    onSourceMode();
    view.focus();
  });
  menu.append(mode);

  document.body.append(menu);
  const margin = 8;
  const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - margin);
  const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - margin);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
  menu.addEventListener("mousedown", (menuEvent) => menuEvent.stopPropagation());
  // En burbuja el propio menú puede detener el mousedown antes de que se
  // considere un clic fuera de él.
  window.addEventListener("mousedown", closeMarkdownMenu, { once: true });
  window.addEventListener("keydown", onMenuKeydown);
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeMarkdownMenu();
}

export function closeMarkdownMenu(): void {
  document.querySelector<HTMLElement>(".markdown-menu")?.remove();
  window.removeEventListener("mousedown", closeMarkdownMenu);
  window.removeEventListener("keydown", onMenuKeydown);
}
