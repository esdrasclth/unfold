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
  dom.innerHTML = `
    <div class="search-row">
      <button class="search-expand" id="sp-expand" title="Reemplazar" aria-expanded="false">
        ${icon("chevronRight")}
      </button>
      <div class="search-field-wrap">
        <input class="search-field" id="sp-find" placeholder="Buscar" autocomplete="off" />
        <div class="search-toggles">
          <button class="search-toggle" id="sp-case" title="Distinguir mayúsculas" aria-pressed="false">Aa</button>
          <button class="search-toggle" id="sp-word" title="Palabra completa" aria-pressed="false">ab|</button>
          <button class="search-toggle" id="sp-regex" title="Expresión regular" aria-pressed="false">.*</button>
        </div>
      </div>
      <span class="search-count" id="sp-count"></span>
      <button class="icon-button" id="sp-prev" title="Anterior (Shift+Enter)">${icon("up")}</button>
      <button class="icon-button" id="sp-next" title="Siguiente (Enter)">${icon("down")}</button>
      <button class="icon-button" id="sp-close" title="Cerrar (Esc)">${icon("close")}</button>
    </div>
    <div class="search-replace-row">
      <div class="search-row">
        <span class="search-expand-hueco" aria-hidden="true"></span>
        <div class="search-field-wrap">
          <input class="search-field" id="sp-replace" placeholder="Reemplazar por" autocomplete="off" />
        </div>
        <button class="search-action" id="sp-one">Reemplazar</button>
        <button class="search-action" id="sp-all">Todo</button>
      </div>
    </div>
  `;

  const REPLACE_KEY = "unfold:search-replace";
  const expand = dom.querySelector<HTMLButtonElement>("#sp-expand")!;
  const setReplacing = (on: boolean): void => {
    dom.classList.toggle("is-replacing", on);
    expand.setAttribute("aria-expanded", String(on));
    localStorage.setItem(REPLACE_KEY, on ? "on" : "off");
  };
  expand.addEventListener("click", () => {
    const on = !dom.classList.contains("is-replacing");
    setReplacing(on);
    if (on) dom.querySelector<HTMLInputElement>("#sp-replace")!.focus();
  });

  const find = dom.querySelector<HTMLInputElement>("#sp-find")!;
  const replace = dom.querySelector<HTMLInputElement>("#sp-replace")!;
  const count = dom.querySelector<HTMLElement>("#sp-count")!;
  const toggles = {
    case: dom.querySelector<HTMLButtonElement>("#sp-case")!,
    word: dom.querySelector<HTMLButtonElement>("#sp-word")!,
    regex: dom.querySelector<HTMLButtonElement>("#sp-regex")!,
  };

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

  dom.querySelector("#sp-prev")!.addEventListener("click", () => findPrevious(view));
  dom.querySelector("#sp-next")!.addEventListener("click", () => findNext(view));
  dom.querySelector("#sp-one")!.addEventListener("click", () => replaceNext(view));
  dom.querySelector("#sp-all")!.addEventListener("click", () => replaceAll(view));
  dom.querySelector("#sp-close")!.addEventListener("click", () => {
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
