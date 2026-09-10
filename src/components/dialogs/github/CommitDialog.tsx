import { useLayoutEffect, useRef } from "preact/hooks";
import type {
  Change,
  ConnectedRepository,
  DocumentState,
  RepositoryDiff,
} from "../../../repositories.ts";
import type { CommitData, CommitDialogController } from "../../../github/CommitDialogController.ts";
import { Dialog } from "../Dialog.tsx";
import { LoadingState } from "../LoadingState.tsx";

const STATE_LABEL: Record<DocumentState, string> = {
  synced: "sin cambios",
  modified: "modificado",
  new: "nuevo",
  conflicted: "en conflicto",
};

export function rotuloDe(change: Change): string {
  if (change.deleted) return "borrado";
  return STATE_LABEL[change.state];
}

/** De qué tipo es cada línea del parche, para pintarla. */
export function claseDeLinea(text: string): string {
  if (text.startsWith("+") && !text.startsWith("+++")) return "commit-diff-line is-addition";
  if (text.startsWith("-") && !text.startsWith("---")) return "commit-diff-line is-deletion";
  if (text.startsWith("@@")) return "commit-diff-line is-hunk";
  if (/^(diff --git|index |--- |\+\+\+ )/.test(text)) return "commit-diff-line is-meta";
  return "commit-diff-line";
}

/**
 * El diff de un archivo.
 *
 * El recuento no se repite aquí: vive en la propia fila, donde además sigue
 * leyéndose con el diff plegado.
 */
function Diff({ diff, onExpand }: { diff: RepositoryDiff; onExpand?: () => void }) {
  if (diff.binary) {
    return <p class="commit-diff-empty">El archivo es binario y no tiene una vista de texto.</p>;
  }
  if (!diff.patch.trim()) {
    return <p class="commit-diff-empty">Git no devolvió líneas para este cambio.</p>;
  }

  return (
    <>
      <div class="commit-diff">
        {diff.patch
          .replace(/\n$/, "")
          .split("\n")
          .map((text, indice) => (
            // El texto va como nodo y nunca interpolado: es contenido de un
            // archivo del repositorio.
            <div key={`${indice}:${text}`} class={claseDeLinea(text)}>
              {text || " "}
            </div>
          ))}
      </div>
      {diff.truncated && (
        <div class="commit-diff-truncated">
          {`Mostrando ${diff.shownLines} de ${diff.totalLines} líneas. `}
          {onExpand ? (
            <button type="button" class="github-link commit-diff-more" onClick={onExpand}>
              Mostrar más
            </button>
          ) : (
            "El límite protege la interfaz en archivos muy grandes."
          )}
        </div>
      )}
    </>
  );
}

function FilaDeCambio({ change, data, controller }: {
  change: Change;
  data: CommitData;
  controller: CommitDialogController;
}) {
  const abierto = data.open.has(change.relative);
  const diff = data.diffs.get(change.relative);
  const leyendo = data.loadingDiff.get(change.relative);
  const fallo = data.diffError.get(change.relative);

  return (
    <div class="commit-change-wrap">
      <div class={`commit-change is-${change.state}`}>
        <input
          type="checkbox"
          aria-label={`Incluir ${change.relative}`}
          checked={data.selected.has(change.relative)}
          disabled={data.working !== null}
          onChange={() => controller.toggle(change.relative)}
        />
        {/*
          El galón está siempre, no sólo al pasar el ratón: es lo único que dice
          que la fila se abre, y una pista que hay que descubrir pasando por
          encima no la descubre quien no pasa por encima.
        */}
        <button
          type="button"
          class="commit-change-name"
          aria-expanded={abierto}
          title={`Ver qué cambió en ${change.relative}`}
          onClick={() => controller.toggleDiff(change)}
        >
          <svg class="commit-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="commit-change-ruta">{change.relative}</span>
        </button>
        {/* El recuento se queda una vez conocido, así que al plegar el diff
            sigue sabiéndose cuánto mueve ese archivo sin reabrirlo. */}
        <span class="commit-change-count">
          {diff ? `+${diff.additions} −${diff.deletions}` : ""}
        </span>
        <span class="commit-change-state">{rotuloDe(change)}</span>
      </div>

      {abierto && (
        <div class="commit-diff-body">
          {fallo && <p class="github-error">{fallo}</p>}
          {!fallo && leyendo && !diff && leyendo}
          {!fallo && diff && (
            <Diff
              diff={diff}
              onExpand={
                diff.truncated && !leyendo ? () => void controller.loadDiff(change, true) : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function Identidad({ data, controller }: {
  data: CommitData;
  controller: CommitDialogController;
}) {
  if (data.identityProblem) {
    return (
      <div class="commit-identity">
        <p class="github-error">{data.identityProblem}</p>
      </div>
    );
  }

  return (
    <div class="commit-identity">
      <p class="commit-identity-line">
        Se firmará como <strong>{data.identity?.name ?? ""}</strong>{" "}
        <span>{data.identity ? `<${data.identity.email}>` : ""}</span>
      </p>
      <label class="commit-noreply">
        <input
          type="checkbox"
          checked={data.forceNoreply}
          disabled={data.working !== null}
          onChange={(event) =>
            controller.setNoreply((event.currentTarget as HTMLInputElement).checked)
          }
        />
        <span>
          Usar mi correo <code>noreply</code> de GitHub
        </span>
      </label>
      <small>
        {data.identity?.source === "noreply"
          ? "GitHub la acepta y la enlaza con tu perfil sin publicar ninguna dirección real."
          : "Sale de user.name y user.email de tu configuración de Git."}
      </small>
    </div>
  );
}

function Informe({ data, controller, onClose }: {
  data: CommitData;
  controller: CommitDialogController;
  onClose: () => void;
}) {
  const done = data.report!;
  const ok = done.pushed;
  const corto = done.commit ? done.commit.slice(0, 7) : "";

  return (
    <div class="github-state">
      <span class={`github-state-icon ${ok ? "is-done" : "is-error"}`}>{ok ? "✓" : "!"}</span>
      <strong>
        {ok ? "Publicado" : done.commit ? "Confirmado, pero sin publicar" : "No se pudo publicar"}
      </strong>
      {ok ? (
        <p>{done.commit ? `El commit ${corto} está en GitHub.` : "No había nada nuevo que publicar."}</p>
      ) : (
        <p class="github-error">{done.problem ?? "GitHub no aceptó la publicación."}</p>
      )}
      <div class="github-actions">
        {!ok && done.commit && (
          <button type="button" class="github-primary" onClick={() => void controller.retryPush()}>
            Reintentar la publicación
          </button>
        )}
        <button
          type="button"
          class={ok ? "github-primary" : "github-secondary"}
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

export interface CommitDialogProps {
  repository: ConnectedRepository;
  data: CommitData;
  controller: CommitDialogController;
  onClose: () => void;
}

/**
 * Vista de cambios y publicación.
 *
 * Al pasar a Preact desaparece toda la maquinaria que había para no perder lo
 * que se está escribiendo: guardar y devolver la posición del cursor, mover las
 * casillas a mano en vez de repintar la lista, y llevar un mapa de referencias
 * a los tres controles que cambiaban sin cambiar de forma. Todo eso existía
 * porque repintar con `innerHTML` destruye el `textarea` en uso; comparando
 * árboles, el nodo se queda donde está y el cursor con él.
 */
export function CommitDialog({ repository, data, controller, onClose }: CommitDialogProps) {
  const puedePublicar = controller.canPublish();
  const bloqueado = data.working !== null;

  /*
   * Al abrirse, el cursor va donde hay que escribir.
   *
   * No lo hace el armazón: cuando el diálogo se monta todavía se están
   * buscando los cambios, y el cuadro de mensaje no existe. Se enfoca la
   * primera vez que aparece, y sólo esa, para no robar el foco a cada
   * repintado de los que vienen después.
   */
  const mensaje = useRef<HTMLTextAreaElement>(null);
  const saludado = useRef(false);
  useLayoutEffect(() => {
    if (saludado.current || !mensaje.current || bloqueado) return;
    saludado.current = true;
    mensaje.current.focus();
  }, [data.loading, bloqueado]);

  return (
    <Dialog
      label={`Publicar cambios en ${repository.fullName}`}
      backdropClass="github-backdrop"
      className="github-dialog commit-dialog"
      // Con algo en marcha no se cierra: publicar a medias no se deshace.
      onClose={bloqueado ? undefined : onClose}
      autoFocus=".commit-message"
    >
      <header class="github-head">
        <div>
          <h2 id="commit-title">Publicar cambios</h2>
          <p class="commit-target">{repository.fullName}</p>
        </div>
        <button
          type="button"
          class="github-close"
          aria-label="Cerrar"
          disabled={bloqueado}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div class="github-content" aria-live="polite">
        {data.report && <Informe data={data} controller={controller} onClose={onClose} />}

        {!data.report && data.loading && <LoadingState label="Buscando cambios…" />}

        {!data.report && !data.loading && (
          <>
            {data.problem && <p class="commit-problem">{data.problem}</p>}

            <div class="github-section-head">
              <strong>Cambios</strong>
              <span>{`${data.selected.size} de ${data.changes.length}`}</span>
              <button
                type="button"
                class="github-link commit-refresh"
                disabled={bloqueado}
                onClick={() => void controller.refreshChanges(true)}
              >
                Actualizar
              </button>
            </div>

            {data.changes.length === 0 ? (
              <>
                <p class="github-empty">No hay nada sin confirmar en este repositorio.</p>
                {/*
                  Sin cambios pero con commits por delante del remoto, lo que
                  falta no es confirmar sino publicar. Sin esta salida el
                  repositorio se quedaría con trabajo hecho y sin forma de
                  subirlo desde aquí.
                */}
                {repository.ahead > 0 && (
                  <button
                    type="button"
                    class="github-primary commit-pending"
                    disabled={bloqueado}
                    onClick={() => void controller.retryPush()}
                  >
                    {repository.ahead === 1
                      ? "Publicar 1 commit pendiente"
                      : `Publicar ${repository.ahead} commits pendientes`}
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  class="github-link commit-select-all"
                  disabled={bloqueado}
                  onClick={controller.toggleAll}
                >
                  {data.selected.size === data.changes.length ? "No marcar ninguno" : "Marcar todos"}
                </button>
                <div class="commit-list">
                  {data.changes.map((change) => (
                    <FilaDeCambio
                      key={change.relative}
                      change={change}
                      data={data}
                      controller={controller}
                    />
                  ))}
                </div>
              </>
            )}

            <div class="github-section-head">
              <strong>Mensaje</strong>
            </div>
            <textarea
              ref={mensaje}
              class="commit-message"
              rows={3}
              placeholder="Qué cambia y por qué"
              value={data.message}
              disabled={bloqueado}
              onInput={(event) =>
                controller.setMessage((event.currentTarget as HTMLTextAreaElement).value)
              }
              onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
                event.preventDefault();
                if (puedePublicar) void controller.run();
              }}
            />

            <Identidad data={data} controller={controller} />
          </>
        )}
      </div>

      {/*
        Las acciones viven fuera del área que scrollea. Ancladas con `sticky`
        flotaban por encima de la identidad y la dejaban a medio leer; siendo un
        pie de verdad, el contenido pasa por debajo y nunca queda tapado.
      */}
      <div class="commit-foot" hidden={Boolean(data.report) || data.loading}>
        <div class="commit-actions">
          {data.working && <span class="commit-working">{data.working}</span>}
          <button type="button" class="github-secondary" disabled={bloqueado} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            class="github-primary"
            title="Ctrl+Enter"
            disabled={!puedePublicar}
            onClick={() => void controller.run()}
          >
            Confirmar y publicar
          </button>
        </div>
      </div>
    </Dialog>
  );
}
