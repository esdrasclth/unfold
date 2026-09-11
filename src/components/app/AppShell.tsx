import { TitleBar, type TitleBarActions, type TitleBarState } from "./TitleBar.tsx";
import { DialogHost, type HostedDialog } from "../dialogs/DialogHost.tsx";

/**
 * Los nodos que otros necesitan de verdad.
 *
 * CodeMirror y los paneles no son componentes: montan su propio contenido
 * dentro de un elemento. El armazón los pinta y entrega la referencia; nadie
 * los busca por identificador.
 */
export interface AppHosts {
  titlebarFile: HTMLElement | null;
  recentButton: HTMLElement | null;
  windowControls: HTMLElement | null;
  update: HTMLElement | null;
  repositories: HTMLElement | null;
  outline: HTMLElement | null;
  tabBar: HTMLElement | null;
  editorHost: HTMLElement | null;
  settings: HTMLElement | null;
  statusbar: HTMLElement | null;
}

export interface AppShellState extends TitleBarState {
  /** El archivo cambió fuera y hay cambios sin guardar. */
  conflict: boolean;
  dialogs: readonly HostedDialog[];
}

export interface AppShellActions extends TitleBarActions {
  onReloadFromDisk: () => void;
  onKeepMine: () => void;
}

export interface AppShellProps {
  state: AppShellState;
  actions: AppShellActions;
  hosts: AppHosts;
  [key: string]: unknown;
}

/**
 * La estructura de la aplicación.
 *
 * Sustituye al bloque de HTML que `main.ts` metía con `innerHTML`. Lo que
 * cambia de aspecto —los botones encendidos, el aviso de conflicto— sale del
 * estado; lo que aloja contenido ajeno se entrega por referencia.
 *
 * Los huecos llevan `dangerouslySetInnerHTML` vacío a propósito: es como se le
 * dice a Preact que dentro manda otro. Sin eso, el primer repintado del armazón
 * se llevaría por delante el editor, los paneles y la barra de estado.
 */
export function AppShell({ state, actions, hosts }: AppShellProps) {
  const hueco = (clave: keyof AppHosts) => (nodo: HTMLElement | null) => {
    hosts[clave] = nodo;
  };
  const ajeno = { __html: "" };

  return (
    <>
      <TitleBar
        state={state}
        actions={actions}
        fileRef={hueco("titlebarFile")}
        recentButtonRef={hueco("recentButton")}
        windowControlsRef={hueco("windowControls")}
      />

      <div id="update" hidden ref={hueco("update")} dangerouslySetInnerHTML={ajeno} />

      <div class="conflict-bar" id="conflict" role="alert" hidden={!state.conflict}>
        <span class="conflict-text">
          Este archivo ha cambiado fuera de Unfold y tienes cambios sin guardar.
        </span>
        <button type="button" class="conflict-action" onClick={actions.onReloadFromDisk}>
          Cargar la versión del disco
        </button>
        <button type="button" class="conflict-action is-quiet" onClick={actions.onKeepMine}>
          Mantener la mía
        </button>
      </div>

      <div class="workspace">
        <aside
          class={`repositories${state.repositories ? "" : " is-collapsed"}`}
          id="repositories"
          inert={!state.repositories}
          ref={hueco("repositories")}
          dangerouslySetInnerHTML={ajeno}
        />
        <aside
          class={`outline${state.outline ? "" : " is-collapsed"}`}
          id="outline"
          inert={!state.outline}
          ref={hueco("outline")}
          dangerouslySetInnerHTML={ajeno}
        />
        <div class="editor-column">
          <div
            class="tab-bar"
            id="tab-bar"
            role="tablist"
            aria-label="Documentos abiertos"
            ref={hueco("tabBar")}
            dangerouslySetInnerHTML={ajeno}
          />
          {/* CodeMirror manda dentro de esto desde que se crea. */}
          <main
            class="editor-host"
            id="editor-host"
            ref={hueco("editorHost")}
            dangerouslySetInnerHTML={ajeno}
          />
        </div>
        <aside
          class={`settings${state.settings ? " is-open" : ""}`}
          id="settings"
          inert={!state.settings}
          ref={hueco("settings")}
          dangerouslySetInnerHTML={ajeno}
        />
      </div>

      <footer
        class="statusbar"
        id="statusbar"
        role="contentinfo"
        ref={hueco("statusbar")}
        dangerouslySetInnerHTML={ajeno}
      />

      <DialogHost dialogs={state.dialogs} />
    </>
  );
}
