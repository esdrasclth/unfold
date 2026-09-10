import { useLayoutEffect, useRef } from "preact/hooks";
import type {
  ConnectedRepository,
  RepositoryDocument,
} from "../../../repositories.ts";
import type { GithubRepository, InstallationState } from "../../../github.ts";
import type { GithubData } from "../../../github/GithubDialogController.ts";
import { icon } from "../../../ui/icons.ts";
import { LoadingState } from "../LoadingState.tsx";

/** Texto de apoyo de un repositorio conectado: dónde está y qué le falta. */
export function detalleDe(repository: ConnectedRepository): string {
  if (repository.missing) return "La copia local ya no está";
  const partes = [repository.branch ?? repository.defaultBranch];
  if (repository.changed > 0) {
    partes.push(
      repository.changed === 1
        ? "1 cambio sin confirmar"
        : `${repository.changed} cambios sin confirmar`,
    );
  }
  if (!repository.canPush) partes.push("sólo lectura");
  return partes.join(" · ");
}

export function detalleDisponible(repository: GithubRepository): string {
  return (
    `${repository.private ? "Privado" : "Público"} · ${repository.defaultBranch}` +
    (repository.canPush ? "" : " · sólo lectura")
  );
}

export function Vacio({ children }: { children: string }) {
  return <p class="github-empty">{children}</p>;
}

/**
 * Menú de la cuenta.
 *
 * Sus dos acciones se usan de higos a brevas y una borra la credencial del
 * equipo, así que se guardan detrás de un botón discreto pero conservan su
 * texto completo: un icono suelto para algo que casi nunca haces obliga a
 * adivinar justo cuando menos conviene.
 */
function AccountMenu({ onManage, onSignOut, onDismiss }: {
  onManage: () => void;
  onSignOut: () => void;
  onDismiss: () => void;
}) {
  const propio = useRef<HTMLDivElement>(null);
  // En una ref: `onDismiss` es una función nueva en cada pintado, y con ella
  // como dependencia el efecto se rehacía entero cada vez —quitando y poniendo
  // el oyente, y robando el foco de vuelta al abrirse.
  const descartar = useRef(onDismiss);
  descartar.current = onDismiss;

  useLayoutEffect(() => {
    const fuera = (event: MouseEvent): void => {
      if (!propio.current?.contains(event.target as Node)) descartar.current();
    };
    document.addEventListener("mousedown", fuera, true);
    propio.current?.querySelector<HTMLElement>(".menu-item")?.focus();
    // Se quita al desmontar: repintar se llevaba el nodo por delante y dejaba
    // su oyente puesto en el documento para siempre.
    return () => document.removeEventListener("mousedown", fuera, true);
  }, []);

  return (
    <div class="menu github-menu" role="menu" ref={propio}>
      <button
        type="button"
        class="menu-item"
        role="menuitem"
        data-action="manage"
        title="Elegir en GitHub qué repositorios puede ver Unfold"
        onClick={onManage}
      >
        Administrar acceso en GitHub
      </button>
      <button
        type="button"
        class="menu-item is-danger"
        role="menuitem"
        data-action="logout"
        title="Borra la credencial de este equipo; no revoca nada en GitHub"
        onClick={onSignOut}
      >
        Cerrar sesión en este dispositivo
      </button>
    </div>
  );
}

/**
 * La cuenta, y sus acciones con ella.
 *
 * Antes estaban en un pie al final del contenido, y ese contenido crece con
 * cada repositorio: con unos cuantos conectados, cerrar sesión quedaba a varias
 * vueltas de rueda. No son acciones de la lista, son de quien está conectado, y
 * ahí es donde se buscan.
 */
export function AccountSection({ data, onConnect, onToggleMenu, onManage, onSignOut }: {
  data: GithubData;
  onConnect: () => void;
  onToggleMenu: (open?: boolean) => void;
  onManage: () => void;
  onSignOut: () => void;
}) {
  const user = data.status.connected ? data.status.user : null;

  if (!user) {
    return (
      <div class="github-signin">
        <div class="github-signin-text">
          <strong>Conecta tu cuenta de GitHub</strong>
          <span>
            Autorizas una vez y eliges a qué repositorios damos acceso. Puedes cambiarlo cuando
            quieras.
          </span>
        </div>
        <button type="button" class="github-primary" onClick={onConnect}>
          Conectar
        </button>
      </div>
    );
  }

  return (
    <div class="github-account">
      <img class="github-avatar" alt="" src={user.avatarUrl} />
      <div class="github-identity">
        <strong>{user.name || user.login}</strong>
        <span>@{user.login}</span>
      </div>
      <span class="github-connected">Conectado</span>
      <div class="github-menu-anchor">
        <button
          type="button"
          class="github-more"
          aria-haspopup="menu"
          aria-expanded={data.menuOpen}
          aria-label="Más acciones de la cuenta"
          title="Más acciones"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu();
          }}
          dangerouslySetInnerHTML={{ __html: icon("more") }}
        />
        {data.menuOpen && (
          <AccountMenu
            onManage={onManage}
            onSignOut={onSignOut}
            onDismiss={() => onToggleMenu(false)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Explica cuánto ve Unfold y lleva a cambiarlo.
 *
 * Sin esto, alguien con la instalación limitada a un repositorio no tenía forma
 * de enterarse de por qué no aparecen los demás, ni de dónde se arregla. La
 * pantalla es de GitHub y no se puede traer aquí, pero sí se puede señalar.
 */
export function AccessBanner({ installation, granted, onOpen }: {
  installation: InstallationState;
  granted: readonly GithubRepository[];
  onOpen: () => void;
}) {
  const sinInstalar = !installation.installed;
  return (
    <div class="github-access">
      <div class="github-access-text">
        <strong>
          {sinInstalar
            ? "Unfold todavía no tiene acceso a ningún repositorio"
            : `Unfold sólo ve ${granted.length === 1 ? "1 repositorio" : `${granted.length} repositorios`}`}
        </strong>
        <span>
          {sinInstalar
            ? "Elige en GitHub cuáles puede ver. Puedes darle acceso a todos y decidir aquí con cuáles trabajas."
            : "Son los que marcaste al instalar. Añade otros, o dale acceso a todos para verlos aquí sin volver a GitHub."}
        </span>
      </div>
      <button
        type="button"
        class={sinInstalar ? "github-secondary" : "github-primary"}
        onClick={onOpen}
      >
        {sinInstalar ? "Elegir repositorios" : "Cambiar en GitHub"}
      </button>
    </div>
  );
}

function DocumentList({ repository, documents, onOpen }: {
  repository: ConnectedRepository;
  documents: readonly RepositoryDocument[] | undefined;
  onOpen: (repository: ConnectedRepository, document: RepositoryDocument) => void;
}) {
  if (!documents) {
    return (
      <div class="github-document-list">
        <LoadingState label="Buscando documentos…" />
      </div>
    );
  }
  if (documents.length === 0) {
    return (
      <div class="github-document-list">
        <Vacio>Este repositorio todavía no tiene documentos Markdown.</Vacio>
      </div>
    );
  }
  return (
    <div class="github-document-list">
      {documents.map((document) => (
        <button
          key={document.path}
          type="button"
          class="github-document"
          onClick={() => onOpen(repository, document)}
        >
          <span class="github-document-name">{document.relative}</span>
          <span class="github-document-tag">{document.tracked ? "" : "sin añadir"}</span>
        </button>
      ))}
    </div>
  );
}

export function ConnectedCard({ repository, data, onToggle, onFetch, onOpenInGithub, onDisconnect, onOpenDocument }: {
  repository: ConnectedRepository;
  data: GithubData;
  onToggle: (repository: ConnectedRepository) => void;
  onFetch: (repository: ConnectedRepository) => void;
  onOpenInGithub: (repository: ConnectedRepository) => void;
  onDisconnect: (repository: ConnectedRepository) => void;
  onOpenDocument: (repository: ConnectedRepository, document: RepositoryDocument) => void;
}) {
  const trabajando = data.busy.get(repository.id);
  const abierto = data.expanded.has(repository.id);

  return (
    <div
      class={`github-repository-card${repository.missing ? " is-missing" : ""}${abierto ? " is-open" : ""}`}
    >
      <button
        type="button"
        class="github-repository-head"
        aria-expanded={abierto}
        disabled={repository.missing}
        onClick={() => onToggle(repository)}
      >
        <span class="github-caret" aria-hidden="true">
          ▸
        </span>
        <span class="github-repository-name">{repository.fullName}</span>
        <span class="github-repository-meta">{trabajando ?? detalleDe(repository)}</span>
      </button>

      <div class="github-card-actions">
        <button
          type="button"
          class="github-link"
          data-action="fetch"
          disabled={Boolean(trabajando) || repository.missing}
          onClick={() => onFetch(repository)}
        >
          Traer cambios
        </button>
        <button
          type="button"
          class="github-link"
          data-action="open"
          disabled={Boolean(trabajando)}
          onClick={() => onOpenInGithub(repository)}
        >
          Ver en GitHub
        </button>
        <button
          type="button"
          class="github-link is-danger"
          data-action="disconnect"
          disabled={Boolean(trabajando)}
          onClick={() => onDisconnect(repository)}
        >
          Desconectar
        </button>
      </div>

      {abierto && (
        <DocumentList
          repository={repository}
          documents={data.documents.get(repository.id)}
          onOpen={onOpenDocument}
        />
      )}
    </div>
  );
}

export function AvailableSection({ data, onConnect }: {
  data: GithubData;
  onConnect: (repository: GithubRepository) => void;
}) {
  const conocidos = new Set(data.connected.map((repository) => repository.id));
  const disponibles = data.granted.filter((repository) => !conocidos.has(repository.id));

  return (
    <div class="github-section">
      <div class="github-section-head">
        <strong>Disponibles para conectar</strong>
        <span>{disponibles.length}</span>
      </div>

      {data.grantedError && <Vacio>{data.grantedError}</Vacio>}

      {!data.grantedError && disponibles.length === 0 && (
        <Vacio>
          {data.granted.length === 0
            ? "Ninguno todavía: elige arriba a cuáles das acceso."
            : "Ya están todos conectados."}
        </Vacio>
      )}

      {!data.grantedError &&
        disponibles.map((repository) => {
          const trabajando = data.busy.get(repository.id);
          return (
            <div key={repository.id} class="github-available">
              <div class="github-available-text">
                <span class="github-repository-name">{repository.fullName}</span>
                <span class="github-repository-meta">{detalleDisponible(repository)}</span>
              </div>
              <button
                type="button"
                class="github-secondary"
                disabled={Boolean(trabajando)}
                onClick={() => onConnect(repository)}
              >
                {trabajando ?? "Conectar"}
              </button>
            </div>
          );
        })}
    </div>
  );
}
