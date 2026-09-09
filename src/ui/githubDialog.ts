import {
  githubAuthStatus,
  githubInstallationState,
  listGithubRepositories,
  logoutGithub,
  openGithubUrl,
  pollGithubDeviceFlow,
  startGithubDeviceFlow,
  type DeviceAuthorization,
  type GithubAuthStatus,
  type GithubRepository,
  type InstallationState,
} from "../github.ts";
import {
  advanceMessage,
  connectRepository,
  connectedRepositories,
  disconnectRepository,
  fetchRepository,
  onCloneProgress,
  repositoryDocuments,
  touchRepository,
  type ConnectedRepository,
  type RepositoryDocument,
} from "../repositories.ts";
import { isTauri } from "../files.ts";
import { icon } from "./icons.ts";
import { confirmDialog } from "./confirmDialog.ts";

export interface GithubDialogOptions {
  onStatusChange?: (status: GithubAuthStatus) => void;
  /** Abre un documento del repositorio en una pestaña. */
  onOpenDocument?: (path: string, name: string) => void;
  /** Cuántos repositorios hay conectados, cada vez que cambia. */
  onRepositoriesChange?: (count: number) => void;
}

const DISCONNECTED: GithubAuthStatus = { connected: false, user: null, expiresAt: null };

// Se guarda el cierre, no el elemento: quitar el nodo del DOM no cancelaría
// el sondeo ni el atajo de Escape del diálogo anterior.
let closeCurrent: (() => void) | null = null;

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "No se pudo completar la operación";
}

function nameOf(relative: string): string {
  return relative.split("/").pop() ?? relative;
}

/** Texto de apoyo de un repositorio conectado: dónde está y qué le falta. */
function repositoryDetail(repository: ConnectedRepository): string {
  if (repository.missing) return "La copia local ya no está";
  const parts = [repository.branch ?? repository.defaultBranch];
  if (repository.changed > 0) {
    parts.push(repository.changed === 1 ? "1 cambio sin confirmar" : `${repository.changed} cambios sin confirmar`);
  }
  if (!repository.canPush) parts.push("sólo lectura");
  return parts.join(" · ");
}

export function openGithubDialog(options: GithubDialogOptions = {}): void {
  closeCurrent?.();
  let closed = false;
  let pollTimer: number | undefined;
  let pollGeneration = 0;
  let stopProgress: (() => void) | null = null;

  // Estado del diálogo. `granted` sólo se puede pedir con sesión y con red;
  // `connected` sale del catálogo local y no necesita ninguna de las dos.
  let status: GithubAuthStatus = DISCONNECTED;
  let granted: GithubRepository[] = [];
  let grantedError: string | null = null;
  let connected: ConnectedRepository[] = [];
  let connectedError: string | null = null;
  let installation: InstallationState | null = null;
  /** Se mandó a alguien a GitHub y hay que releer cuando vuelva. */
  let awaitingReturn = false;
  /** Cierra el menú de la cuenta, si está desplegado. */
  let closeMenu: (() => void) | null = null;

  const expanded = new Set<number>();
  const documents = new Map<number, RepositoryDocument[]>();
  const busy = new Map<number, string>();

  const backdrop = document.createElement("div");
  backdrop.className = "github-backdrop";
  backdrop.innerHTML = `
    <section class="github-dialog" role="dialog" aria-modal="true" aria-labelledby="github-title">
      <header class="github-head">
        <div>
          <h2 id="github-title">GitHub</h2>
          <p>Repositorios Markdown conectados con Unfold</p>
        </div>
        <button class="github-close" type="button" aria-label="Cerrar">×</button>
      </header>
      <div class="github-content" aria-live="polite"></div>
    </section>
  `;
  const content = backdrop.querySelector<HTMLElement>(".github-content")!;

  const close = (): void => {
    closed = true;
    pollGeneration++;
    window.clearTimeout(pollTimer);
    stopProgress?.();
    stopProgress = null;
    closeMenu?.();
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("focus", onReturn);
    backdrop.remove();
    if (closeCurrent === close) closeCurrent = null;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    // Con una confirmación abierta encima, manda ella. Los dos escuchan en
    // fase de captura y éste se registró antes, así que sin esta salida se
    // cerraría el de abajo y dejaría la pregunta huérfana en pantalla.
    if (document.querySelector(".dialog-backdrop")) return;
    event.preventDefault();
    event.stopPropagation();
    // Se cierra lo último que se abrió: primero el menú, después el diálogo.
    if (closeMenu) closeMenu();
    else close();
  };

  /** Reemplaza el contenido conservando dónde estaba el desplazamiento. */
  const swap = (build: () => Node): void => {
    // Repintar se lleva por delante el nodo del menú; sin esto quedaría su
    // oyente de clic suelto en el documento para siempre.
    closeMenu?.();
    const top = content.scrollTop;
    content.replaceChildren(build());
    content.scrollTop = top;
  };

  const loading = (message: string): void => {
    content.innerHTML = `<div class="github-loading"><span></span></div>`;
    content.querySelector(".github-loading")!.append(message);
  };

  const showError = (error: unknown, retry: () => void): void => {
    content.innerHTML = `
      <div class="github-state">
        <span class="github-state-icon is-error">!</span>
        <strong>No se pudo conectar</strong>
        <p class="github-error"></p>
        <button class="github-primary" type="button">Reintentar</button>
      </div>
    `;
    content.querySelector<HTMLElement>(".github-error")!.textContent = messageOf(error);
    content.querySelector("button")!.addEventListener("click", retry);
  };

  // --- Autorización ----------------------------------------------------------

  const showAuthorization = (authorization: DeviceAuthorization): void => {
    content.innerHTML = `
      <div class="github-state github-authorize">
        <strong>Autoriza Unfold en GitHub</strong>
        <p>Abre GitHub, introduce este código y confirma el acceso.</p>
        <button class="github-code" type="button" title="Copiar código"></button>
        <div class="github-actions">
          <button class="github-primary" id="github-open-auth" type="button">Abrir GitHub</button>
          <button class="github-secondary" id="github-copy-code" type="button">Copiar código</button>
        </div>
        <small class="github-waiting">Esperando autorización…</small>
      </div>
    `;
    const code = content.querySelector<HTMLButtonElement>(".github-code")!;
    code.textContent = authorization.userCode;
    const copy = async (): Promise<void> => {
      await navigator.clipboard.writeText(authorization.userCode);
      const waiting = content.querySelector<HTMLElement>(".github-waiting");
      if (waiting) waiting.textContent = "Código copiado. Esperando autorización…";
    };
    code.addEventListener("click", () => void copy());
    content.querySelector("#github-copy-code")!.addEventListener("click", () => void copy());
    content.querySelector("#github-open-auth")!.addEventListener("click", () => {
      void openGithubUrl(authorization.verificationUri).catch((error) => showError(error, load));
    });
  };

  const beginAuthorization = async (): Promise<void> => {
    loading("Preparando autorización…");
    try {
      const authorization = await startGithubDeviceFlow();
      if (closed) return;
      showAuthorization(authorization);
      const generation = ++pollGeneration;
      const expiresAt = Date.now() + authorization.expiresIn * 1000;
      let delay = Math.max(authorization.interval, 5) * 1000;

      const poll = async (): Promise<void> => {
        if (closed || generation !== pollGeneration) return;
        if (Date.now() >= expiresAt) {
          showError("El código caducó. Solicita uno nuevo.", () => void beginAuthorization());
          return;
        }
        try {
          const result = await pollGithubDeviceFlow(authorization.deviceCode);
          if (closed || generation !== pollGeneration) return;
          if (result.state === "authorized") {
            await load();
            return;
          }
          if (result.state === "expired") {
            showError("El código caducó. Solicita uno nuevo.", () => void beginAuthorization());
            return;
          }
          if (result.state === "denied") {
            showError("La autorización fue cancelada en GitHub.", () => void beginAuthorization());
            return;
          }
          if (result.state === "slow_down") delay += 5_000;
          if (result.retryAfter > 0) delay = Math.max(delay, result.retryAfter * 1000);
          pollTimer = window.setTimeout(() => void poll(), delay);
        } catch (error) {
          showError(error, () => void beginAuthorization());
        }
      };
      pollTimer = window.setTimeout(() => void poll(), delay);
    } catch (error) {
      showError(error, () => void beginAuthorization());
    }
  };

  // --- Secciones -------------------------------------------------------------

  const accountSection = (): Node => {
    const section = document.createElement("div");
    if (!status.connected || !status.user) {
      section.className = "github-signin";
      section.innerHTML = `
        <div class="github-signin-text">
          <strong>Conecta tu cuenta de GitHub</strong>
          <span>Autorizas una vez y eliges a qué repositorios damos acceso. Puedes cambiarlo cuando quieras.</span>
        </div>
        <button class="github-primary" type="button">Conectar</button>
      `;
      section
        .querySelector("button")!
        .addEventListener("click", () => void beginAuthorization());
      return section;
    }

    /*
     * Las acciones de la cuenta van aquí arriba, con la cuenta.
     *
     * Antes estaban en un pie al final del contenido, y ese contenido crece
     * con cada repositorio: con unos cuantos conectados, cerrar sesión quedaba
     * a varias vueltas de rueda. No son acciones de la lista, son de quien
     * está conectado, y ahí es donde se buscan.
     */
    const user = status.user;
    section.className = "github-account";
    section.innerHTML = `
      <img class="github-avatar" alt="" />
      <div class="github-identity">
        <strong></strong>
        <span></span>
      </div>
      <span class="github-connected">Conectado</span>
      <div class="github-menu-anchor">
        <button class="github-more" type="button" aria-haspopup="menu" aria-expanded="false"
                aria-label="Más acciones de la cuenta" title="Más acciones">${icon("more")}</button>
      </div>
    `;
    section.querySelector<HTMLImageElement>(".github-avatar")!.src = user.avatarUrl;
    section.querySelector<HTMLElement>(".github-identity strong")!.textContent = user.name || user.login;
    section.querySelector<HTMLElement>(".github-identity span")!.textContent = `@${user.login}`;

    const anchor = section.querySelector<HTMLElement>(".github-menu-anchor")!;
    const trigger = section.querySelector<HTMLButtonElement>(".github-more")!;
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (closeMenu) {
        closeMenu();
        return;
      }
      openAccountMenu(anchor, trigger);
    });
    return section;
  };

  /**
   * Menú de la cuenta.
   *
   * Sus dos acciones se usan de higos a brevas y una borra la credencial del
   * equipo, así que se guardan detrás de un botón discreto pero conservan su
   * texto completo: un icono suelto para algo que casi nunca haces obliga a
   * adivinar justo cuando menos conviene.
   */
  const openAccountMenu = (anchor: HTMLElement, trigger: HTMLButtonElement): void => {
    const menu = document.createElement("div");
    menu.className = "menu github-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button class="menu-item" role="menuitem" data-action="manage" type="button">Administrar acceso en GitHub</button>
      <button class="menu-item is-danger" role="menuitem" data-action="logout" type="button">Cerrar sesión en este dispositivo</button>
    `;

    const dismiss = (): void => {
      document.removeEventListener("mousedown", onOutside, true);
      menu.remove();
      trigger.setAttribute("aria-expanded", "false");
      closeMenu = null;
    };
    function onOutside(event: MouseEvent): void {
      if (!menu.contains(event.target as Node)) dismiss();
    }

    const manage = menu.querySelector<HTMLButtonElement>('[data-action="manage"]')!;
    manage.title = "Elegir en GitHub qué repositorios puede ver Unfold";
    manage.addEventListener("click", () => {
      dismiss();
      // La página de esta instalación cuando se sabe cuál es; el listado
      // general sólo como respaldo.
      void openGithubUrl(installation?.configureUrl ?? "https://github.com/settings/installations");
      awaitingReturn = true;
    });

    const logout = menu.querySelector<HTMLButtonElement>('[data-action="logout"]')!;
    logout.title = "Borra la credencial de este equipo; no revoca nada en GitHub";
    logout.addEventListener("click", () => {
      dismiss();
      void signOut();
    });

    anchor.append(menu);
    trigger.setAttribute("aria-expanded", "true");
    closeMenu = dismiss;
    document.addEventListener("mousedown", onOutside, true);
    manage.focus();
  };

  const documentList = (repository: ConnectedRepository): Node => {
    const list = document.createElement("div");
    list.className = "github-document-list";

    const found = documents.get(repository.id);
    if (!found) {
      list.innerHTML = `<div class="github-loading"><span></span></div>`;
      list.querySelector(".github-loading")!.append("Buscando documentos…");
      return list;
    }
    if (found.length === 0) {
      const empty = document.createElement("p");
      empty.className = "github-empty";
      empty.textContent = "Este repositorio todavía no tiene documentos Markdown.";
      list.append(empty);
      return list;
    }

    for (const document_ of found) {
      const item = document.createElement("button");
      item.className = "github-document";
      item.type = "button";
      item.innerHTML = `<span class="github-document-name"></span><span class="github-document-tag"></span>`;
      item.querySelector<HTMLElement>(".github-document-name")!.textContent = document_.relative;
      if (!document_.tracked) {
        item.querySelector<HTMLElement>(".github-document-tag")!.textContent = "sin añadir";
      }
      item.addEventListener("click", () => {
        options.onOpenDocument?.(document_.path, nameOf(document_.relative));
        void touchRepository(repository.id);
        close();
      });
      list.append(item);
    }
    return list;
  };

  const connectedCard = (repository: ConnectedRepository): Node => {
    const card = document.createElement("div");
    card.className = "github-repository-card";
    if (repository.missing) card.classList.add("is-missing");

    const working = busy.get(repository.id);
    card.innerHTML = `
      <button class="github-repository-head" type="button" aria-expanded="false">
        <span class="github-caret" aria-hidden="true">▸</span>
        <span class="github-repository-name"></span>
        <span class="github-repository-meta"></span>
      </button>
      <div class="github-card-actions">
        <button class="github-link" data-action="fetch" type="button">Traer cambios</button>
        <button class="github-link" data-action="open" type="button">Ver en GitHub</button>
        <button class="github-link is-danger" data-action="disconnect" type="button">Desconectar</button>
      </div>
    `;

    const head = card.querySelector<HTMLButtonElement>(".github-repository-head")!;
    head.querySelector<HTMLElement>(".github-repository-name")!.textContent = repository.fullName;
    head.querySelector<HTMLElement>(".github-repository-meta")!.textContent =
      working ?? repositoryDetail(repository);
    head.setAttribute("aria-expanded", String(expanded.has(repository.id)));
    if (expanded.has(repository.id)) card.classList.add("is-open");
    head.disabled = repository.missing;
    head.addEventListener("click", () => void toggleDocuments(repository));

    for (const button of card.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      if (working) button.disabled = true;
      button.addEventListener("click", () => {
        const action = button.dataset.action;
        if (action === "fetch") void bringChanges(repository);
        if (action === "disconnect") void disconnect(repository);
        if (action === "open") void openGithubUrl(`https://github.com/${repository.fullName}`);
      });
    }
    if (repository.missing) {
      card.querySelector<HTMLButtonElement>('[data-action="fetch"]')!.disabled = true;
    }

    if (expanded.has(repository.id)) card.append(documentList(repository));
    return card;
  };

  /**
   * Explica cuánto ve Unfold y lleva a cambiarlo.
   *
   * Es la pieza que faltaba: sin ella, alguien con la instalación limitada a
   * un repositorio no tenía forma de enterarse de por qué no aparecen los
   * demás, ni de dónde se arregla. La pantalla es de GitHub y no se puede
   * traer aquí, pero sí se puede señalar.
   */
  const accessBanner = (): Node | null => {
    if (!status.connected || !installation) return null;
    if (installation.installed && installation.allRepositories) return null;

    const banner = document.createElement("div");
    banner.className = "github-access";
    banner.innerHTML = `
      <div class="github-access-text">
        <strong></strong>
        <span></span>
      </div>
      <button class="github-secondary" type="button"></button>
    `;

    const title = banner.querySelector<HTMLElement>("strong")!;
    const detail = banner.querySelector<HTMLElement>("span")!;
    const action = banner.querySelector<HTMLButtonElement>("button")!;

    if (!installation.installed) {
      title.textContent = "Unfold todavía no tiene acceso a ningún repositorio";
      detail.textContent =
        "Elige en GitHub cuáles puede ver. Puedes darle acceso a todos y decidir aquí con cuáles trabajas.";
      action.textContent = "Elegir repositorios";
    } else {
      title.textContent = `Unfold sólo ve ${granted.length === 1 ? "1 repositorio" : `${granted.length} repositorios`}`;
      detail.textContent =
        "Son los que marcaste al instalar. Añade otros, o dale acceso a todos para verlos aquí sin volver a GitHub.";
      action.textContent = "Cambiar en GitHub";
      action.classList.add("github-primary");
      action.classList.remove("github-secondary");
    }

    action.addEventListener("click", () => {
      void openGithubUrl(installation!.configureUrl);
      // Al volver del navegador la lista se relee sola, así que no hace falta
      // decirle a nadie que pulse actualizar.
      awaitingReturn = true;
    });
    return banner;
  };

  const availableSection = (): Node | null => {
    const known = new Set(connected.map((repository) => repository.id));
    const available = granted.filter((repository) => !known.has(repository.id));
    if (!status.connected) return null;

    const section = document.createElement("div");
    section.className = "github-section";
    section.innerHTML = `
      <div class="github-section-head">
        <strong>Disponibles para conectar</strong>
        <span></span>
      </div>
    `;
    section.querySelector<HTMLElement>(".github-section-head span")!.textContent = String(available.length);

    if (grantedError) {
      const problem = document.createElement("p");
      problem.className = "github-empty";
      problem.textContent = grantedError;
      section.append(problem);
      return section;
    }
    if (available.length === 0) {
      const empty = document.createElement("p");
      empty.className = "github-empty";
      empty.textContent =
        granted.length === 0
          ? "Ninguno todavía: elige arriba a cuáles das acceso."
          : "Ya están todos conectados.";
      section.append(empty);
      return section;
    }

    for (const repository of available) {
      const row = document.createElement("div");
      row.className = "github-available";
      row.innerHTML = `
        <div class="github-available-text">
          <span class="github-repository-name"></span>
          <span class="github-repository-meta"></span>
        </div>
        <button class="github-secondary" type="button">Conectar</button>
      `;
      row.querySelector<HTMLElement>(".github-repository-name")!.textContent = repository.fullName;
      row.querySelector<HTMLElement>(".github-repository-meta")!.textContent =
        `${repository.private ? "Privado" : "Público"} · ${repository.defaultBranch}` +
        (repository.canPush ? "" : " · sólo lectura");
      const button = row.querySelector<HTMLButtonElement>("button")!;
      const working = busy.get(repository.id);
      if (working) {
        button.disabled = true;
        button.textContent = working;
      }
      button.addEventListener("click", () => void connect(repository));
      section.append(row);
    }
    return section;
  };

  const render = (): void => {
    swap(() => {
      const root = document.createDocumentFragment();
      root.append(accountSection());
      const access = accessBanner();
      if (access) root.append(access);

      const section = document.createElement("div");
      section.className = "github-section";
      section.innerHTML = `
        <div class="github-section-head">
          <strong>Conectados</strong>
          <span></span>
        </div>
      `;
      section.querySelector<HTMLElement>(".github-section-head span")!.textContent = String(connected.length);

      if (connectedError) {
        const problem = document.createElement("p");
        problem.className = "github-empty";
        problem.textContent = connectedError;
        section.append(problem);
      } else if (connected.length === 0) {
        const empty = document.createElement("p");
        empty.className = "github-empty";
        empty.textContent = status.connected
          ? "Conecta un repositorio para tener sus documentos en Unfold."
          : "Todavía no hay repositorios conectados en este equipo.";
        section.append(empty);
      } else {
        for (const repository of connected) section.append(connectedCard(repository));
      }
      root.append(section);

      const available = availableSection();
      if (available) root.append(available);
      return root;
    });
  };

  // --- Acciones --------------------------------------------------------------

  const toggleDocuments = async (repository: ConnectedRepository): Promise<void> => {
    if (expanded.has(repository.id)) {
      expanded.delete(repository.id);
      render();
      return;
    }
    expanded.add(repository.id);
    render();
    if (documents.has(repository.id)) return;

    try {
      const found = await repositoryDocuments(repository.id);
      if (closed) return;
      documents.set(repository.id, found);
      render();
    } catch (error) {
      if (closed) return;
      expanded.delete(repository.id);
      connectedError = messageOf(error);
      render();
    }
  };

  const connect = async (repository: GithubRepository): Promise<void> => {
    busy.set(repository.id, "Preparando…");
    render();

    // El progreso llega por evento desde Rust. Se engancha sólo mientras dura
    // el clone y se suelta al terminar, pase lo que pase.
    stopProgress?.();
    stopProgress = await onCloneProgress((progress) => {
      if (progress.id !== repository.id) return;
      const percent = progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0;
      busy.set(repository.id, `Clonando… ${percent}%`);
      render();
    });

    try {
      await connectRepository(repository.id);
      if (closed) return;
      documents.delete(repository.id);
      await refreshCatalog();
    } catch (error) {
      if (closed) return;
      connectedError = messageOf(error);
    } finally {
      stopProgress?.();
      stopProgress = null;
      busy.delete(repository.id);
      if (!closed) render();
    }
  };

  const bringChanges = async (repository: ConnectedRepository): Promise<void> => {
    busy.set(repository.id, "Trayendo cambios…");
    render();
    try {
      const report = await fetchRepository(repository.id);
      if (closed) return;
      // El contenido pudo cambiar por debajo: la lista de documentos que
      // hubiera en pantalla ya no vale.
      documents.delete(repository.id);
      connectedError = null;
      await refreshCatalog();
      if (!closed) notifyInline(advanceMessage(report.advance, repository.fullName));
    } catch (error) {
      if (closed) return;
      connectedError = messageOf(error);
    } finally {
      busy.delete(repository.id);
      if (!closed) render();
    }
  };

  const disconnect = async (repository: ConnectedRepository): Promise<void> => {
    const choice = await confirmDialog(
      "Desconectar repositorio",
      `«${repository.fullName}» dejará de aparecer en Unfold. Su copia local puede quedarse en el disco o borrarse; borrarla no toca nada en GitHub.`,
      [
        { label: "Cancelar", cancel: true, value: "cancel" },
        { label: "Desconectar y conservar la copia", primary: true, value: "keep" },
        { label: "Desconectar y borrar la copia", value: "delete" },
      ],
    );
    if (choice !== "keep" && choice !== "delete") return;

    busy.set(repository.id, "Desconectando…");
    render();
    try {
      await disconnectRepository(repository.id, choice === "delete");
      if (closed) return;
      expanded.delete(repository.id);
      documents.delete(repository.id);
      connectedError = null;
      await refreshCatalog();
    } catch (error) {
      if (closed) return;
      connectedError = messageOf(error);
    } finally {
      busy.delete(repository.id);
      if (!closed) render();
    }
  };

  const signOut = async (): Promise<void> => {
    const choice = await confirmDialog(
      "Cerrar sesión de GitHub",
      "Se eliminará la credencial de este equipo. Los repositorios ya clonados siguen en el disco y se pueden seguir abriendo. La GitHub App seguirá instalada hasta que la revoques en GitHub.",
      [
        { label: "Cancelar", cancel: true, value: "cancel" },
        { label: "Cerrar sesión", primary: true, value: "logout" },
      ],
    );
    if (choice !== "logout") return;
    try {
      await logoutGithub();
      if (closed) return;
      status = DISCONNECTED;
      granted = [];
      grantedError = null;
      options.onStatusChange?.(status);
      render();
    } catch (error) {
      if (!closed) showError(error, load);
    }
  };

  /** Aviso breve dentro del diálogo, para lo que no merece cambiar de vista. */
  const notifyInline = (message: string): void => {
    const existing = content.querySelector(".github-notice");
    existing?.remove();
    const notice = document.createElement("p");
    notice.className = "github-notice";
    notice.textContent = message;
    content.prepend(notice);
    window.setTimeout(() => notice.remove(), 6000);
  };

  const refreshCatalog = async (): Promise<void> => {
    try {
      connected = await connectedRepositories();
      connected.sort((left, right) => left.fullName.localeCompare(right.fullName));
      options.onRepositoriesChange?.(connected.length);
    } catch (error) {
      connectedError = messageOf(error);
    }
  };

  async function load(): Promise<void> {
    loading("Comprobando GitHub…");
    connectedError = null;
    grantedError = null;

    // El catálogo primero: es local, no puede fallar por red y es lo que hace
    // que los repositorios sigan estando ahí sin sesión.
    await refreshCatalog();
    if (closed) return;

    try {
      status = await githubAuthStatus();
    } catch (error) {
      status = DISCONNECTED;
      grantedError = messageOf(error);
    }
    if (closed) return;
    options.onStatusChange?.(status);

    await refreshAccess();
  }

  /**
   * Relee lo que GitHub concede: la instalación y sus repositorios.
   *
   * Va aparte de `load` porque también se llama al volver del navegador, y ahí
   * no debe reaparecer la pantalla de carga: quien acaba de cambiar la
   * selección espera encontrarse la lista nueva, no un rótulo.
   */
  async function refreshAccess(): Promise<void> {
    if (!status.connected) {
      granted = [];
      installation = null;
      if (!closed) render();
      return;
    }
    try {
      [installation, granted] = await Promise.all([
        githubInstallationState(),
        listGithubRepositories(),
      ]);
      grantedError = null;
    } catch (error) {
      granted = [];
      grantedError = messageOf(error);
    }
    if (!closed) render();
  }

  /*
   * Cambiar los repositorios ocurre en el navegador, fuera de aquí. Al
   * recuperar el foco se relee, así que la lista nueva está esperando cuando
   * la persona vuelve y nadie tiene que acordarse de pulsar actualizar.
   */
  const onReturn = (): void => {
    if (!awaitingReturn || closed) return;
    awaitingReturn = false;
    void refreshAccess();
  };
  window.addEventListener("focus", onReturn);

  backdrop.querySelector(".github-close")!.addEventListener("click", close);
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  closeCurrent = close;
  backdrop.querySelector<HTMLButtonElement>(".github-close")!.focus();

  if (!isTauri) {
    showError("La conexión con GitHub requiere la aplicación de escritorio.", close);
  } else {
    void load();
  }
}
