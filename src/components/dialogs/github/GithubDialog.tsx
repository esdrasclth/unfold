import type { GithubData, GithubDialogController } from "../../../github/GithubDialogController.ts";
import { Dialog } from "../Dialog.tsx";
import { LoadingState } from "../LoadingState.tsx";
import {
  AccessBanner,
  AccountSection,
  AvailableSection,
  ConnectedCard,
  Vacio,
} from "./GithubSections.tsx";

export interface GithubDialogProps {
  data: GithubData;
  controller: GithubDialogController;
  onClose: () => void;
}

function Autorizar({ data, controller }: { data: GithubData; controller: GithubDialogController }) {
  const codigo = data.authorization?.userCode ?? "";
  return (
    <div class="github-state github-authorize">
      <strong>Autoriza Unfold en GitHub</strong>
      <p>Abre GitHub, introduce este código y confirma el acceso.</p>
      <button
        type="button"
        class="github-code"
        title="Copiar código"
        onClick={() => void controller.copyCode()}
      >
        {codigo}
      </button>
      <div class="github-actions">
        <button type="button" class="github-primary" onClick={controller.openAuthorizationPage}>
          Abrir GitHub
        </button>
        <button type="button" class="github-secondary" onClick={() => void controller.copyCode()}>
          Copiar código
        </button>
      </div>
      <small class="github-waiting">
        {data.codeCopied ? "Código copiado. Esperando autorización…" : "Esperando autorización…"}
      </small>
    </div>
  );
}

function Fallo({ data, controller }: { data: GithubData; controller: GithubDialogController }) {
  return (
    <div class="github-state">
      <span class="github-state-icon is-error">!</span>
      <strong>No se pudo conectar</strong>
      {/* El motivo va como texto: viene del servidor de GitHub. */}
      <p class="github-error">{data.error}</p>
      <button type="button" class="github-primary" onClick={() => controller.reintentar()}>
        Reintentar
      </button>
    </div>
  );
}

/**
 * El diálogo de GitHub.
 *
 * Cuatro vistas y una sola forma: se está leyendo, se falló, hay que autorizar,
 * o está la lista. La decisión la trae el controlador; aquí sólo se elige qué
 * pintar.
 *
 * Escape cierra primero el menú de la cuenta y después el diálogo, porque es lo
 * último que se abrió.
 */
export function GithubDialog({ data, controller, onClose }: GithubDialogProps) {
  return (
    <Dialog
      label="GitHub"
      backdropClass="github-backdrop"
      className="github-dialog"
      onClose={() => {
        if (data.menuOpen) controller.toggleMenu(false);
        else onClose();
      }}
      autoFocus=".github-close"
    >
      <header class="github-head">
        <div>
          <h2 id="github-title">GitHub</h2>
          <p>Repositorios Markdown conectados con Unfold</p>
        </div>
        <button type="button" class="github-close" aria-label="Cerrar" onClick={onClose}>
          ×
        </button>
      </header>

      <div class="github-content" aria-live="polite">
        {data.view === "loading" && <LoadingState label={data.message} />}
        {data.view === "error" && <Fallo data={data} controller={controller} />}
        {data.view === "authorize" && <Autorizar data={data} controller={controller} />}

        {data.view === "list" && (
          <>
            {data.notice && <p class="github-notice">{data.notice}</p>}

            <AccountSection
              data={data}
              onConnect={() => void controller.beginAuthorization()}
              onToggleMenu={controller.toggleMenu}
              onManage={controller.openManage}
              onSignOut={() => void controller.signOut()}
            />

            {data.status.connected
              && data.installation
              && !(data.installation.installed && data.installation.allRepositories) && (
                <AccessBanner
                  installation={data.installation}
                  granted={data.granted}
                  onOpen={controller.openAccess}
                />
              )}

            <div class="github-section">
              <div class="github-section-head">
                <strong>Conectados</strong>
                <span>{data.connected.length}</span>
              </div>

              {data.connectedError && <Vacio>{data.connectedError}</Vacio>}

              {!data.connectedError && data.connected.length === 0 && (
                <Vacio>
                  {data.status.connected
                    ? "Conecta un repositorio para tener sus documentos en Unfold."
                    : "Todavía no hay repositorios conectados en este equipo."}
                </Vacio>
              )}

              {!data.connectedError
                && data.connected.map((repository) => (
                  <ConnectedCard
                    key={repository.id}
                    repository={repository}
                    data={data}
                    onToggle={(r) => void controller.toggleDocuments(r)}
                    onFetch={(r) => void controller.bringChanges(r)}
                    onOpenInGithub={controller.openInGithub}
                    onDisconnect={(r) => void controller.disconnect(r)}
                    onOpenDocument={controller.openDocument}
                  />
                ))}
            </div>

            {data.status.connected && (
              <AvailableSection data={data} onConnect={(r) => void controller.connect(r)} />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
