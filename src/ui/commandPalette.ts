import { icon } from "./icons.ts";
import { aislarFondo } from "./modalFocus.ts";

/** Deshace el aislamiento del fondo; vive fuera porque cerrar es una función suelta. */
let soltarFoco: (() => void) | null = null;

export interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

/**
 * Paleta de comandos.
 *
 * La selección la lleva la paleta y no el foco del navegador: el foco se queda
 * siempre en el campo, para poder seguir escribiendo mientras se recorre la
 * lista con las flechas. Moverlo a cada botón obligaba a volver al campo para
 * afinar la búsqueda.
 */
export function openCommandPalette(actions: readonly CommandAction[]): void {
  closeCommandPalette();

  const backdrop = document.createElement("div");
  backdrop.className = "command-palette-backdrop";
  backdrop.innerHTML = `
    <div class="command-palette" role="dialog" aria-label="Paleta de comandos">
      <div class="command-palette-search">
        ${icon("search")}
        <input class="command-palette-input" placeholder="Buscar una acción…"
               aria-label="Buscar comandos" autocomplete="off"
               role="combobox" aria-expanded="true" aria-controls="paleta-lista" />
      </div>
      <div class="command-palette-list" id="paleta-lista" role="listbox"></div>
      <div class="command-palette-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> moverse</span>
        <span><kbd>↵</kbd> ejecutar</span>
        <span><kbd>Esc</kbd> cerrar</span>
      </div>
    </div>
  `;

  const input = backdrop.querySelector<HTMLInputElement>(".command-palette-input")!;
  const list = backdrop.querySelector<HTMLElement>(".command-palette-list")!;

  let matches: CommandAction[] = [];
  let active = 0;

  /** Resalta el trozo que coincide, que es lo que explica por qué está ahí. */
  const labelNode = (label: string, query: string): Node => {
    const fragment = document.createDocumentFragment();
    const at = query ? label.toLowerCase().indexOf(query) : -1;
    if (at < 0) {
      fragment.append(label);
      return fragment;
    }
    const mark = document.createElement("mark");
    mark.textContent = label.slice(at, at + query.length);
    fragment.append(label.slice(0, at), mark, label.slice(at + query.length));
    return fragment;
  };

  const paint = (): void => {
    for (const [index, row] of [...list.children].entries()) {
      const on = index === active;
      row.classList.toggle("is-active", on);
      row.setAttribute("aria-selected", String(on));
      if (on) row.scrollIntoView({ block: "nearest" });
    }
  };

  const render = (): void => {
    const query = input.value.trim().toLowerCase();
    matches = actions.filter((action) => !query || action.label.toLowerCase().includes(query));
    active = 0;
    list.replaceChildren();

    if (matches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "command-palette-empty";
      empty.textContent = `Ninguna acción coincide con «${input.value.trim()}».`;
      list.append(empty);
      return;
    }

    for (const action of matches) {
      const row = document.createElement("button");
      row.className = "command-palette-item";
      row.type = "button";
      row.setAttribute("role", "option");

      const name = document.createElement("span");
      name.className = "command-palette-label";
      name.append(labelNode(action.label, query));
      row.append(name);

      if (action.shortcut) {
        const keys = document.createElement("span");
        keys.className = "command-palette-keys";
        for (const key of action.shortcut.split("+")) {
          const kbd = document.createElement("kbd");
          kbd.textContent = key;
          keys.append(kbd);
        }
        row.append(keys);
      }

      row.addEventListener("click", () => {
        closeCommandPalette();
        action.run();
      });
      // Apuntar con el ratón mueve la selección, para que no haya dos a la vez.
      row.addEventListener("mousemove", () => {
        const index = [...list.children].indexOf(row);
        if (index !== active) {
          active = index;
          paint();
        }
      });
      list.append(row);
    }
    paint();
  };

  const move = (step: number): void => {
    if (matches.length === 0) return;
    active = (active + step + matches.length) % matches.length;
    paint();
  };

  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const action = matches[active];
      if (!action) return;
      closeCommandPalette();
      action.run();
    }
  });

  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeCommandPalette();
  });

  document.body.append(backdrop);
  soltarFoco = aislarFondo(backdrop);
  render();
  input.focus();
}

export function closeCommandPalette(): void {
  soltarFoco?.();
  soltarFoco = null;
  document.querySelector(".command-palette-backdrop")?.remove();
}
