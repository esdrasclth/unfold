import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { icon } from "./icons.ts";

/** Cuenta las coincidencias y cuál de ellas tiene el cursor encima. */
function summarize(view: EditorView, query: SearchQuery): string {
  if (!query.search) return "";
  if (!query.valid) return "expresión no válida";

  let total = 0;
  let current = 0;
  const head = view.state.selection.main.from;

  try {
    const cursor = query.getCursor(view.state);
    for (let value = cursor.next(); !value.done; value = cursor.next()) {
      total++;
      if (value.value.from <= head) current = total;
    }
  } catch {
    return "expresión no válida";
  }

  if (total === 0) return "sin resultados";
  return `${current || 1} de ${total}`;
}

/**
 * Panel de búsqueda con el aspecto de la aplicación. El de serie de CodeMirror
 * funciona, pero usa los controles del sistema y rompe el diseño justo en el
 * atajo que más se usa.
 */
export function unfoldSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "search-panel";
  /*
   * Las opciones viven dentro del campo, donde se buscan, y no sueltas entre
   * el contador y las flechas. Y reemplazar se despliega: la mayoría de las
   * búsquedas no reemplazan nada, y tenerlo siempre puesto le costaba el doble
   * de alto al atajo que más se usa.
   */
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  };
  const row = make("div", "search-row");
  const expand = make("button", "search-expand");
  expand.type = "button";
  expand.title = "Reemplazar";
  expand.setAttribute("aria-expanded", "false");
  expand.innerHTML = icon("chevronRight");
  const findWrap = make("div", "search-field-wrap");
  const find = make("input", "search-field");
  find.placeholder = "Buscar";
  find.setAttribute("aria-label", "Buscar en el documento");
  find.autocomplete = "off";
  const togglesWrap = make("div", "search-toggles");
  const makeToggle = (title: string, text: string): HTMLButtonElement => {
    const button = make("button", "search-toggle");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-pressed", "false");
    button.textContent = text;
    togglesWrap.append(button);
    return button;
  };
  const toggles = {
    case: makeToggle("Distinguir mayúsculas", "Aa"),
    word: makeToggle("Palabra completa", "ab|"),
    regex: makeToggle("Expresión regular", ".*"),
  };
  findWrap.append(find, togglesWrap);
  const count = make("span", "search-count");
  const button = (className: string, title: string, glyph: string): HTMLButtonElement => {
    const node = make("button", className);
    node.type = "button";
    node.title = title;
    node.setAttribute("aria-label", title);
    node.innerHTML = icon(glyph);
    return node;
  };
  const previous = button("icon-button", "Anterior (Shift+Enter)", "up");
  const next = button("icon-button", "Siguiente (Enter)", "down");
  const close = button("icon-button", "Cerrar (Esc)", "close");
  row.append(expand, findWrap, count, previous, next, close);
  const replaceRow = make("div", "search-replace-row");
  const replaceLine = make("div", "search-row");
  const spacer = make("span", "search-expand-hueco");
  spacer.setAttribute("aria-hidden", "true");
  const replaceWrap = make("div", "search-field-wrap");
  const replace = make("input", "search-field");
  replace.placeholder = "Reemplazar por";
  replace.setAttribute("aria-label", "Reemplazar por");
  replace.autocomplete = "off";
  replaceWrap.append(replace);
  const replaceOne = make("button", "search-action");
  replaceOne.type = "button";
  replaceOne.textContent = "Reemplazar";
  const replaceAllButton = make("button", "search-action");
  replaceAllButton.type = "button";
  replaceAllButton.textContent = "Todo";
  replaceLine.append(spacer, replaceWrap, replaceOne, replaceAllButton);
  replaceRow.append(replaceLine);
  dom.append(row, replaceRow);

  const REPLACE_KEY = "unfold:search-replace";
  const setReplacing = (on: boolean): void => {
    dom.classList.toggle("is-replacing", on);
    expand.setAttribute("aria-expanded", String(on));
    localStorage.setItem(REPLACE_KEY, on ? "on" : "off");
  };
  expand.addEventListener("click", () => {
    const on = !dom.classList.contains("is-replacing");
    setReplacing(on);
    if (on) replace.focus();
  });

  const commit = (): void => {
    const query = new SearchQuery({
      search: find.value,
      replace: replace.value,
      caseSensitive: toggles.case.classList.contains("is-on"),
      wholeWord: toggles.word.classList.contains("is-on"),
      regexp: toggles.regex.classList.contains("is-on"),
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
    count.textContent = summarize(view, query);
  };

  for (const [key, button] of Object.entries(toggles)) {
    button.addEventListener("click", () => {
      button.classList.toggle("is-on");
      button.setAttribute("aria-pressed", String(button.classList.contains("is-on")));
      void key;
      commit();
    });
  }

  find.addEventListener("input", commit);
  replace.addEventListener("input", commit);

  find.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) findPrevious(view);
      else findNext(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  replace.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      replaceNext(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      view.focus();
    }
  });

  previous.addEventListener("click", () => findPrevious(view));
  next.addEventListener("click", () => findNext(view));
  replaceOne.addEventListener("click", () => replaceNext(view));
  replaceAllButton.addEventListener("click", () => replaceAll(view));
  close.addEventListener("click", () => {
    closeSearchPanel(view);
    view.focus();
  });

  return {
    dom,
    top: true,
    mount() {
      setReplacing(localStorage.getItem(REPLACE_KEY) === "on");
      const existing = getSearchQuery(view.state);
      if (existing.search) find.value = existing.search;
      toggles.case.classList.toggle("is-on", existing.caseSensitive);
      toggles.word.classList.toggle("is-on", existing.wholeWord);
      toggles.regex.classList.toggle("is-on", existing.regexp);
      count.textContent = summarize(view, existing);
      find.select();
      find.focus();
    },
    update(update: ViewUpdate) {
      // El contador debe seguir al cursor y al documento, no sólo al teclear.
      if (update.docChanged || update.selectionSet) {
        count.textContent = summarize(view, getSearchQuery(update.state));
      }
    },
  };
}
