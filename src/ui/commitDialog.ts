import { aislarFondo } from "./modalFocus.ts";
import {
  commitIdentity,
  publish,
  pushPending,
  onPublishProgress,
  repositoryChanges,
  repositoryDiff,
  PUBLISH_PHASE_LABEL,
  type Change,
  type ConnectedRepository,
  type DocumentState,
  type Identity,
  type PublishReport,
  type RepositoryDiff,
} from "../repositories.ts";

const NOREPLY_KEY = "unfold:github-noreply";

export interface CommitDialogOptions {
  /** Se llama cuando algo cambió en el repositorio y hay que repintar. */
  onChanged?: () => void;
  /** Aviso breve en la barra de estado del editor. */
  notify?: (message: string) => void;
}

let closeCurrent: (() => void) | null = null;

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "No se pudo completar la operación";
}

const STATE_LABEL: Record<DocumentState, string> = {
  synced: "sin cambios",
  modified: "modificado",
  new: "nuevo",
  conflicted: "en conflicto",
};

function labelOf(change: Change): string {
  if (change.deleted) return "borrado";
  return STATE_LABEL[change.state];
}

function diffNode(diff: RepositoryDiff, expand?: () => void): Node {
  // El recuento no se repite aquí: vive en la propia fila, donde además sigue
  // leyéndose con el diff plegado.
  const fragment = document.createDocumentFragment();

  if (diff.binary) {
    const note = document.createElement("p");
    note.className = "commit-diff-empty";
    note.textContent = "El archivo es binario y no tiene una vista de texto.";
    fragment.append(note);
    return fragment;
  }
  if (!diff.patch.trim()) {
    const note = document.createElement("p");
    note.className = "commit-diff-empty";
    note.textContent = "Git no devolvió líneas para este cambio.";
    fragment.append(note);
    return fragment;
  }
  const pre = document.createElement("div");
  pre.className = "commit-diff";
  for (const text of diff.patch.replace(/\n$/, "").split("\n")) {
    const line = document.createElement("div");
    line.className = "commit-diff-line";
    if (text.startsWith("+") && !text.startsWith("+++")) line.classList.add("is-addition");
    else if (text.startsWith("-") && !text.startsWith("---")) line.classList.add("is-deletion");
    else if (text.startsWith("@@")) line.classList.add("is-hunk");
    else if (/^(diff --git|index |--- |\+\+\+ )/.test(text)) line.classList.add("is-meta");
    line.textContent = text || " ";
    pre.append(line);
  }
  fragment.append(pre);
  if (diff.truncated) {
    const footer = document.createElement("div");
    footer.className = "commit-diff-truncated";
    footer.append(`Mostrando ${diff.shownLines} de ${diff.totalLines} líneas. `);
    if (expand) {
      const more = document.createElement("button");
      more.className = "github-link commit-diff-more";
      more.type = "button";
      more.textContent = "Mostrar más";
      more.addEventListener("click", expand);
      footer.append(more);
    } else {
      footer.append("El límite protege la interfaz en archivos muy grandes.");
    }
    fragment.append(footer);
  }
  return fragment;
}

/**
 * Vista de cambios y publicación.
 *
 * Los tres pasos —elegir, describir y publicar— caben en una sola pantalla a
 * propósito: separarlos en un asistente obligaría a recordar lo que se marcó
 * mientras se escribe el mensaje, que es justo cuando hace falta tenerlo
 * delante.
 */
export function openCommitDialog(
  repository: ConnectedRepository,
  options: CommitDialogOptions = {},
): void {
  closeCurrent?.();
  let closed = false;

  let changes: Change[] = [];
  const selected = new Set<string>();
  let identity: Identity | null = null;
  let identityProblem: string | null = null;
  let forceNoreply = localStorage.getItem(NOREPLY_KEY) === "on";
  let message = "";
  let working: string | null = null;
  let problem: string | null = null;
  let report: PublishReport | null = null;
  const diffs = new Map<string, RepositoryDiff>();
  /** El cuadro de mensaje sólo se enfoca solo la primera vez. */
  let greeted = false;

  const backdrop = document.createElement("div");
  backdrop.className = "github-backdrop";
  backdrop.innerHTML = `
    <section class="github-dialog commit-dialog" role="dialog" aria-modal="true" aria-labelledby="commit-title">
      <header class="github-head">
        <div>
          <h2 id="commit-title">Publicar cambios</h2>
          <p class="commit-target"></p>
        </div>
        <button class="github-close" type="button" aria-label="Cerrar">×</button>
      </header>
      <div class="github-content" aria-live="polite"></div>
      <div class="commit-foot" hidden></div>
    </section>
  `;
  backdrop.querySelector<HTMLElement>(".commit-target")!.textContent = repository.fullName;
  const content = backdrop.querySelector<HTMLElement>(".github-content")!;
  // Las acciones viven fuera del área que scrollea. Ancladas con `sticky`
  // flotaban por encima de la identidad y la dejaban a medio leer; siendo un
  // pie de verdad, el contenido pasa por debajo y nunca queda tapado.
  const foot = backdrop.querySelector<HTMLElement>(".commit-foot")!;

  let soltarFoco: (() => void) | null = null;
  const close = (): void => {
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    soltarFoco?.();
    soltarFoco = null;
    backdrop.remove();
    if (closeCurrent === close) closeCurrent = null;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || working) return;
    // Igual que en el diálogo de GitHub: una confirmación abierta encima es
    // quien tiene que responder al Escape.
    if (document.querySelector(".dialog-backdrop")) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const loading = (text: string): void => {
    content.innerHTML = `<div class="github-loading"><span></span></div>`;
    content.querySelector(".github-loading")!.append(text);
  };

  // --- Informe final ---------------------------------------------------------

  const renderReport = (): void => {
    const done = report!;
    const wrapper = document.createElement("div");
    wrapper.className = "github-state";

    const ok = done.pushed;
    wrapper.innerHTML = `
      <span class="github-state-icon ${ok ? "is-done" : "is-error"}">${ok ? "✓" : "!"}</span>
      <strong></strong>
      <p></p>
      <div class="github-actions"></div>
    `;
    wrapper.querySelector("strong")!.textContent = ok
      ? "Publicado"
      : done.commit
        ? "Confirmado, pero sin publicar"
        : "No se pudo publicar";

    const detail = wrapper.querySelector<HTMLElement>("p")!;
    if (ok) {
      const short = done.commit ? done.commit.slice(0, 7) : "";
      detail.textContent = done.commit
        ? `El commit ${short} está en GitHub.`
        : "No había nada nuevo que publicar.";
    } else {
      detail.textContent = done.problem ?? "GitHub no aceptó la publicación.";
      detail.classList.add("github-error");
    }

    const actions = wrapper.querySelector<HTMLElement>(".github-actions")!;
    // Reintentar publica lo ya confirmado: repetir el commit apilaría uno
    // vacío encima del que ya existe.
    if (!ok && done.commit) {
      const retry = document.createElement("button");
      retry.className = "github-primary";
      retry.type = "button";
      retry.textContent = "Reintentar la publicación";
      retry.addEventListener("click", () => void retryPush());
      actions.append(retry);
    }
    const dismiss = document.createElement("button");
    dismiss.className = ok ? "github-primary" : "github-secondary";
    dismiss.type = "button";
    dismiss.textContent = "Cerrar";
    dismiss.addEventListener("click", close);
    actions.append(dismiss);

    content.replaceChildren(wrapper);
  };

  // --- Formulario ------------------------------------------------------------

  const canPublish = (): boolean =>
    !working && selected.size > 0 && message.trim().length > 0 && identity !== null;

  /*
   * Referencias a lo que cambia sin cambiar de forma.
   *
   * Marcar una casilla o escribir la primera letra sólo mueve un contador y el
   * estado de un botón. Repintar el diálogo entero por eso destruye el
   * `textarea` que se está usando y tira el cursor fuera, así que estos tres
   * se actualizan en su sitio.
   */
  let publishButton: HTMLButtonElement | null = null;
  let counter: HTMLElement | null = null;
  let selectAll: HTMLButtonElement | null = null;
  const boxes = new Map<string, HTMLInputElement>();
  let refreshChanges: (preserveSelection: boolean) => Promise<void>;

  const syncControls = (): void => {
    if (counter) counter.textContent = `${selected.size} de ${changes.length}`;
    if (selectAll) {
      selectAll.textContent =
        selected.size === changes.length ? "No marcar ninguno" : "Marcar todos";
    }
    if (publishButton) publishButton.disabled = !canPublish();
  };

  const render = (): void => {
    if (report) {
      renderReport();
      return;
    }

    const fragment = document.createDocumentFragment();
    publishButton = null;
    counter = null;
    selectAll = null;
    boxes.clear();

    if (problem) {
      const warning = document.createElement("p");
      warning.className = "commit-problem";
      warning.textContent = problem;
      fragment.append(warning);
    }

    // Lista de cambios con su casilla.
    const head = document.createElement("div");
    head.className = "github-section-head";
    head.innerHTML = `<strong>Cambios</strong><span></span>`;
    counter = head.querySelector<HTMLElement>("span")!;
    const refresh = document.createElement("button");
    refresh.className = "github-link commit-refresh";
    refresh.type = "button";
    refresh.textContent = "Actualizar";
    refresh.disabled = working !== null;
    refresh.addEventListener("click", () => void refreshChanges(true));
    head.append(refresh);
    fragment.append(head);

    if (changes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "github-empty";
      empty.textContent = "No hay nada sin confirmar en este repositorio.";
      fragment.append(empty);

      // Sin cambios pero con commits por delante del remoto, lo que falta no
      // es confirmar sino publicar. Sin esta salida el repositorio se quedaría
      // con trabajo hecho y sin forma de subirlo desde aquí.
      if (repository.ahead > 0) {
        const pending = document.createElement("button");
        pending.className = "github-primary commit-pending";
        pending.type = "button";
        pending.disabled = working !== null;
        pending.textContent =
          repository.ahead === 1
            ? "Publicar 1 commit pendiente"
            : `Publicar ${repository.ahead} commits pendientes`;
        pending.addEventListener("click", () => void retryPush());
        fragment.append(pending);
      }
    } else {
      const all = document.createElement("button");
      all.className = "github-link commit-select-all";
      all.type = "button";
      all.disabled = working !== null;
      all.addEventListener("click", () => {
        if (selected.size === changes.length) selected.clear();
        else for (const change of changes) selected.add(change.relative);
        // Se mueven las casillas que ya están puestas en vez de rehacer la
        // lista: así el mensaje a medio escribir no pierde el foco.
        for (const [relative, box] of boxes) box.checked = selected.has(relative);
        syncControls();
      });
      selectAll = all;
      fragment.append(all);

      const list = document.createElement("div");
      list.className = "commit-list";
      for (const change of changes) {
        const wrapper = document.createElement("div");
        wrapper.className = "commit-change-wrap";
        const row = document.createElement("div");
        row.className = `commit-change is-${change.state}`;
        // El galón está siempre, no sólo al pasar el ratón: es lo único que
        // dice que la fila se abre, y una pista que hay que descubrir pasando
        // por encima no la descubre quien no pasa por encima.
        row.innerHTML = `
          <input type="checkbox" />
          <button class="commit-change-name" type="button" aria-expanded="false">
            <svg class="commit-chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="commit-change-ruta"></span>
          </button>
          <span class="commit-change-count"></span>
          <span class="commit-change-state"></span>
        `;
        const box = row.querySelector<HTMLInputElement>("input")!;
        box.setAttribute("aria-label", `Incluir ${change.relative}`);
        box.checked = selected.has(change.relative);
        box.disabled = working !== null;
        boxes.set(change.relative, box);
        box.addEventListener("change", () => {
          if (box.checked) selected.add(change.relative);
          else selected.delete(change.relative);
          syncControls();
        });
        row.querySelector<HTMLElement>(".commit-change-ruta")!.textContent = change.relative;
        row.querySelector<HTMLElement>(".commit-change-state")!.textContent = labelOf(change);
        const toggle = row.querySelector<HTMLButtonElement>(".commit-change-name")!;
        toggle.title = `Ver qué cambió en ${change.relative}`;

        // El recuento se queda en la fila una vez conocido, así que al plegar
        // el diff sigue sabiéndose cuánto mueve ese archivo sin reabrirlo.
        const counter = row.querySelector<HTMLElement>(".commit-change-count")!;
        const showCount = (diff: RepositoryDiff): void => {
          counter.textContent = `+${diff.additions} −${diff.deletions}`;
        };
        const known = diffs.get(change.relative);
        if (known) showCount(known);

        toggle.addEventListener("click", () => {
          const existing = wrapper.querySelector<HTMLElement>(".commit-diff-body");
          if (existing) {
            existing.hidden = !existing.hidden;
            toggle.setAttribute("aria-expanded", String(!existing.hidden));
            return;
          }
          const body = document.createElement("div");
          body.className = "commit-diff-body";
          body.textContent = "Preparando vista previa…";
          wrapper.append(body);
          toggle.setAttribute("aria-expanded", "true");
          const loadDiff = async (expanded = false): Promise<void> => {
            body.textContent = expanded ? "Ampliando vista previa…" : "Preparando vista previa…";
            try {
              const diff = await repositoryDiff(repository.id, change.relative, expanded);
              diffs.set(change.relative, diff);
              showCount(diff);
              // La huella pertenece al contenido que acaba de mostrarse. Si el
              // archivo cambió desde que se abrió el diálogo, ésta sustituye a
              // la instantánea inicial y publicar validará exactamente el diff.
              change.fingerprint = diff.fingerprint;
              if (!closed && body.isConnected) {
                body.replaceChildren(diffNode(diff, diff.truncated && !expanded ? () => void loadDiff(true) : undefined));
              }
            } catch (error) {
              if (body.isConnected) body.textContent = messageOf(error);
            }
          };
          const cached = diffs.get(change.relative);
          if (cached) {
            body.replaceChildren(diffNode(cached, cached.truncated ? () => void loadDiff(true) : undefined));
          } else {
            void loadDiff();
          }
        });
        wrapper.append(row);
        list.append(wrapper);
      }
      fragment.append(list);
    }

    // Mensaje del commit.
    const messageHead = document.createElement("div");
    messageHead.className = "github-section-head";
    messageHead.innerHTML = `<strong>Mensaje</strong>`;
    fragment.append(messageHead);

    const textarea = document.createElement("textarea");
    textarea.className = "commit-message";
    textarea.rows = 3;
    textarea.placeholder = "Qué cambia y por qué";
    textarea.value = message;
    textarea.disabled = working !== null;
    textarea.addEventListener("input", () => {
      message = textarea.value;
      syncControls();
    });
    textarea.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
      event.preventDefault();
      if (canPublish()) void run();
    });
    fragment.append(textarea);

    // Identidad del autor.
    fragment.append(identityBlock());

    // Acciones.
    const actions = document.createElement("div");
    actions.className = "commit-actions";
    if (working) {
      const busy = document.createElement("span");
      busy.className = "commit-working";
      busy.textContent = working;
      actions.append(busy);
    }
    const cancel = document.createElement("button");
    cancel.className = "github-secondary";
    cancel.type = "button";
    cancel.textContent = "Cancelar";
    cancel.disabled = working !== null;
    cancel.addEventListener("click", close);
    const go = document.createElement("button");
    go.className = "github-primary";
    go.type = "button";
    go.textContent = "Confirmar y publicar";
    go.title = "Ctrl+Enter";
    go.addEventListener("click", () => void run());
    publishButton = go;
    actions.append(cancel, go);
    foot.replaceChildren(actions);
    foot.hidden = false;
    syncControls();

    /*
     * Repintar sigue siendo necesario cuando la forma cambia de verdad —al
     * llegar la identidad, al fallar algo—, y eso puede pasar mientras se
     * escribe. Se anota dónde estaba el cursor y se devuelve a su sitio, para
     * que ningún repintado futuro vuelva a echar a nadie del cuadro.
     */
    const writing = document.activeElement;
    const caret =
      writing instanceof HTMLTextAreaElement && writing.classList.contains("commit-message")
        ? ([writing.selectionStart, writing.selectionEnd] as const)
        : null;
    // La casilla del noreply repinta al resolver la identidad contra GitHub, y
    // volver del viaje con el foco en ningún sitio es igual de molesto.
    const onNoreply = writing instanceof HTMLInputElement && writing.closest(".commit-noreply") !== null;

    const top = content.scrollTop;
    content.replaceChildren(fragment);
    content.scrollTop = top;

    if (caret) {
      textarea.focus();
      textarea.setSelectionRange(caret[0], caret[1]);
    } else if (onNoreply) {
      content.querySelector<HTMLInputElement>(".commit-noreply input")?.focus();
    } else if (!greeted && !working) {
      // Al abrirse, el cursor va donde hay que escribir.
      greeted = true;
      textarea.focus();
    }
  };

  const identityBlock = (): Node => {
    const block = document.createElement("div");
    block.className = "commit-identity";

    if (identityProblem) {
      block.innerHTML = `<p class="github-error"></p>`;
      block.querySelector("p")!.textContent = identityProblem;
      return block;
    }

    block.innerHTML = `
      <p class="commit-identity-line">Se firmará como <strong></strong> <span></span></p>
      <label class="commit-noreply">
        <input type="checkbox" />
        <span>Usar mi correo <code>noreply</code> de GitHub</span>
      </label>
      <small></small>
    `;
    block.querySelector<HTMLElement>("strong")!.textContent = identity?.name ?? "";
    block.querySelector<HTMLElement>(".commit-identity-line span")!.textContent =
      identity ? `<${identity.email}>` : "";

    const box = block.querySelector<HTMLInputElement>("input")!;
    box.checked = forceNoreply;
    box.disabled = working !== null;
    box.addEventListener("change", () => {
      forceNoreply = box.checked;
      localStorage.setItem(NOREPLY_KEY, forceNoreply ? "on" : "off");
      void loadIdentity();
    });

    block.querySelector<HTMLElement>("small")!.textContent =
      identity?.source === "noreply"
        ? "GitHub la acepta y la enlaza con tu perfil sin publicar ninguna dirección real."
        : "Sale de user.name y user.email de tu configuración de Git.";
    return block;
  };

  // --- Datos -----------------------------------------------------------------

  const loadIdentity = async (): Promise<void> => {
    try {
      identity = await commitIdentity(forceNoreply);
      identityProblem = null;
    } catch (error) {
      identity = null;
      identityProblem = messageOf(error);
    }
    if (!closed) render();
  };

  refreshChanges = async (preserveSelection: boolean): Promise<void> => {
    const previous = new Set(selected);
    working = preserveSelection ? "Actualizando cambios…" : "Buscando cambios…";
    problem = null;
    if (!preserveSelection) loading("Buscando cambios…");
    else render();
    try {
      const next = await repositoryChanges(repository.id);
      if (closed) return;
      changes = next;
      selected.clear();
      for (const change of changes) {
        // La primera carga marca todo. Una recuperación conserva la decisión
        // anterior y nunca añade silenciosamente archivos aparecidos después.
        if (!preserveSelection || previous.has(change.relative)) selected.add(change.relative);
      }
      diffs.clear();
    } catch (error) {
      if (closed) return;
      problem = messageOf(error);
    } finally {
      working = null;
    }
    if (!closed) render();
  };

  const load = async (): Promise<void> => {
    await refreshChanges(false);
    await loadIdentity();
  };

  const finish = (done: PublishReport): void => {
    report = done;
    options.onChanged?.();
    if (done.pushed) options.notify?.(`Publicado en ${repository.fullName}`);
    render();
  };

  const run = async (): Promise<void> => {
    working = PUBLISH_PHASE_LABEL.committing;
    problem = null;
    render();

    /*
     * Publicar son tres pasos y dos salen a la red. Con un solo texto fijo, la
     * espera larga —comprobar el remoto y subir— no se distinguía de que la
     * aplicación se hubiera quedado colgada.
     */
    // Se espera al oyente antes de arrancar: cuesta un tic y evita la carrera
    // de que el primer paso ocurra antes de que haya nadie escuchando. Si
    // registrarlo falla se publica igual: el avance es una cortesía, y quedarse
    // sin publicar por no poder contarlo sería un mal negocio.
    let unlisten: () => void | Promise<void> = () => {};
    try {
      unlisten = await onPublishProgress((progress) => {
        if (closed || progress.id !== repository.id) return;
        working = PUBLISH_PHASE_LABEL[progress.phase];
        render();
      });
    } catch (error) {
      console.warn("No se pudo seguir el avance de la publicación", error);
    }

    try {
      const reviewed = changes
        .filter((change) => selected.has(change.relative))
        .map(({ relative, fingerprint }) => ({ relative, fingerprint }));
      finish(await publish(repository.id, reviewed, message, forceNoreply));
    } catch (error) {
      if (closed) return;
      problem = messageOf(error);
    } finally {
      working = null;
      // Cerrar el oyente es limpieza, no parte del resultado: si falla, la
      // publicación ya ocurrió y su informe no se toca.
      try {
        await unlisten();
      } catch (error) {
        console.warn("No se pudo cerrar el oyente de avance", error);
      }
      if (!closed && !report) render();
    }
  };

  const retryPush = async (): Promise<void> => {
    working = "Publicando…";
    report = null;
    problem = null;
    render();
    try {
      finish(await pushPending(repository.id));
    } catch (error) {
      if (closed) return;
      problem = messageOf(error);
    } finally {
      working = null;
      if (!closed && !report) render();
    }
  };

  backdrop.querySelector(".github-close")!.addEventListener("click", () => {
    if (!working) close();
  });
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop && !working) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  soltarFoco = aislarFondo(backdrop);
  closeCurrent = close;

  void load();
}
