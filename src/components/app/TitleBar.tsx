import { icon } from "../../ui/icons.ts";

export interface TitleBarState {
  theme: string;
  sourceMode: boolean;
  typewriter: boolean;
  focusMode: boolean;
  outline: boolean;
  repositories: boolean;
  settings: boolean;
  recent: boolean;
  githubActive: boolean;
  githubTitle: string;
  /** Punto en ajustes mientras haya una versión pendiente de instalar. */
  updatePending: string | null;
}

export interface TitleBarActions {
  onOutline: () => void;
  onRepositories: () => void;
  onRecent: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSearch: () => void;
  onGithub: () => void;
  onExport: () => void;
  onPrint: () => void;
  onSource: () => void;
  onFocus: () => void;
  onTypewriter: () => void;
  onTheme: () => void;
  onSettings: () => void;
}

export interface TitleBarProps {
  state: TitleBarState;
  actions: TitleBarActions;
  /** Dónde van el nombre del documento y los controles de ventana. */
  fileRef: (node: HTMLElement | null) => void;
  recentButtonRef: (node: HTMLElement | null) => void;
  windowControlsRef: (node: HTMLElement | null) => void;
}

function Boton({ id, title, glyph, on, pressed, label, badge, buttonRef, onClick }: {
  id: string;
  title: string;
  glyph: string;
  on?: boolean;
  pressed?: boolean;
  label?: string;
  badge?: boolean;
  buttonRef?: (node: HTMLElement | null) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      class={`icon-button${on ? " is-on" : ""}${badge ? " has-badge" : ""}`}
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      ref={buttonRef}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: glyph }}
    />
  );
}

/**
 * La barra de título.
 *
 * Cuatro grupos, y dentro de cada uno los botones pegados: el archivo, lo que
 * sale de él, cómo se escribe y cómo se ve. Doce iconos seguidos a la misma
 * distancia obligan a leerlos uno a uno para encontrar el que se busca;
 * separados por lo que hacen, se va directo al grupo.
 *
 * Lo que está encendido sale del estado y no de tocar clases a mano. Es el
 * criterio de la fase: nadie busca un botón por su identificador para decir
 * que ahora está activo.
 */
export function TitleBar({
  state,
  actions,
  fileRef,
  recentButtonRef,
  windowControlsRef,
}: TitleBarProps) {
  return (
    <header class="titlebar" data-tauri-drag-region>
      <Boton
        id="btn-outline"
        title="Esquema (Ctrl+Shift+O)"
        glyph={icon("panel")}
        on={state.outline}
        onClick={actions.onOutline}
      />
      <Boton
        id="btn-repositories"
        title="Repositorios (Ctrl+Shift+B)"
        glyph={icon("repositories")}
        on={state.repositories}
        onClick={actions.onRepositories}
      />

      <div class="titlebar-file is-compact" id="titlebar-file" ref={fileRef} />

      <div class="titlebar-actions">
        <div class="titlebar-group">
          <Boton
            id="btn-recent"
            title="Recientes"
            glyph={icon("clock")}
            on={state.recent}
            buttonRef={recentButtonRef}
            onClick={actions.onRecent}
          />
          <Boton id="btn-open" title="Abrir (Ctrl+O)" glyph={icon("open")} onClick={actions.onOpen} />
          <Boton id="btn-save" title="Guardar (Ctrl+S)" glyph={icon("save")} onClick={actions.onSave} />
          <Boton
            id="btn-search"
            title="Buscar (Ctrl+F)"
            glyph={icon("search")}
            onClick={actions.onSearch}
          />
        </div>

        <div class="titlebar-group">
          <Boton
            id="btn-github"
            title={state.githubTitle}
            glyph={icon("github")}
            on={state.githubActive}
            onClick={actions.onGithub}
          />
          <Boton
            id="btn-export"
            title="Exportar a HTML (Ctrl+Shift+E)"
            glyph={icon("export")}
            onClick={actions.onExport}
          />
          <Boton
            id="btn-print"
            title="Imprimir o guardar en PDF (Ctrl+P)"
            glyph={icon("print")}
            onClick={actions.onPrint}
          />
        </div>

        <div class="titlebar-group">
          <Boton
            id="btn-source"
            title={state.sourceMode ? "Vista renderizada" : "Código fuente"}
            label={
              state.sourceMode ? "Cambiar a vista renderizada" : "Cambiar a código fuente"
            }
            glyph={icon("code")}
            on={state.sourceMode}
            pressed={state.sourceMode}
            onClick={actions.onSource}
          />
          <Boton
            id="btn-focus"
            title="Modo enfoque (Ctrl+Shift+F)"
            glyph={icon("focus")}
            on={state.focusMode}
            pressed={state.focusMode}
            onClick={actions.onFocus}
          />
          <Boton
            id="btn-typewriter"
            title="Modo máquina de escribir (Ctrl+Shift+T)"
            glyph={icon("typewriter")}
            on={state.typewriter}
            pressed={state.typewriter}
            onClick={actions.onTypewriter}
          />
        </div>

        <div class="titlebar-group">
          <Boton
            id="btn-theme"
            title="Cambiar tema"
            glyph={icon(state.theme === "dark" ? "sun" : "moon")}
            onClick={actions.onTheme}
          />
          <Boton
            id="btn-settings"
            title={
              state.updatePending
                ? `Apariencia (Ctrl+,) · Unfold ${state.updatePending} disponible`
                : "Apariencia (Ctrl+,)"
            }
            glyph={icon("sliders")}
            on={state.settings}
            badge={state.updatePending !== null}
            onClick={actions.onSettings}
          />
        </div>
      </div>

      <div class="window-controls" id="window-controls" ref={windowControlsRef} />
    </header>
  );
}
