import type { GithubAuthStatus } from "../../github.ts";
import { icon } from "../../ui/icons.ts";

/** A partir de aquí la caducidad de la sesión pasa a ser lo más urgente. */
export const AVISO_CADUCIDAD_DIAS = 14;

export function diasHastaCaducar(expiresAt: number | null): number | null {
  if (!expiresAt) return null;
  return Math.ceil((expiresAt * 1000 - Date.now()) / 86_400_000);
}

/**
 * La segunda línea del pie: una cosa, y siempre la más urgente.
 *
 * En marcha normal, quién eres y cuánto tienes conectado; si la sesión se va a
 * acabar, eso, porque es lo único ahí que pide hacer algo.
 */
export function textoDeCuenta(login: string, repositories: number, dias: number | null): string {
  if (dias !== null && dias <= AVISO_CADUCIDAD_DIAS) {
    if (dias <= 0) return "La sesión ha caducado: vuelve a conectar";
    return dias === 1 ? "La sesión caduca mañana" : `La sesión caduca en ${dias} días`;
  }
  const cuenta =
    repositories === 0
      ? "sin repositorios"
      : repositories === 1
        ? "1 repositorio"
        : `${repositories} repositorios`;
  return `@${login} · ${cuenta}`;
}

export interface RepositoryFooterProps {
  account: GithubAuthStatus | null;
  /** Repositorios de GitHub; las carpetas locales no cuentan aquí. */
  repositories: number;
  onManage: () => void;
}

/**
 * El pie con la cuenta de GitHub.
 *
 * El avatar puede no llegar —sin red, o con la imagen caída— y ese es un estado
 * corriente en una aplicación que funciona sin conexión, así que la inicial
 * sobre el acento no es un adorno: es lo que se ve la mitad de las veces que se
 * abre el portátil en un tren. La foto se pinta encima cuando carga.
 */
export function RepositoryFooter({ account, repositories, onManage }: RepositoryFooterProps) {
  const user = account?.connected ? account.user : null;

  if (!user) {
    return (
      <button
        type="button"
        class="repos-account"
        id="repos-manage"
        title="Conectar una cuenta de GitHub"
        onClick={onManage}
      >
        <span class="repos-account-avatar" id="repos-avatar">
          <span class="repos-account-anon" dangerouslySetInnerHTML={{ __html: icon("github") }} />
        </span>
        <span class="repos-account-text">
          <span class="repos-account-name" id="repos-account-name">GitHub</span>
          <span class="repos-account-meta" id="repos-account-meta">Conectar una cuenta</span>
        </span>
        <span class="repos-account-go" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon("more") }} />
      </button>
    );
  }

  const dias = diasHastaCaducar(account?.refreshExpiresAt ?? null);
  const caduca = dias !== null && dias <= AVISO_CADUCIDAD_DIAS;
  const meta = textoDeCuenta(user.login, repositories, dias);

  return (
    <button
      type="button"
      class={`repos-account is-connected${caduca ? " is-expiring" : ""}`}
      id="repos-manage"
      title={
        caduca
          ? `@${user.login} — ${meta}. Vuelve a conectar desde aquí.`
          : `Sesión de GitHub iniciada como @${user.login} — administrar repositorios`
      }
      onClick={onManage}
    >
      <span class="repos-account-avatar" id="repos-avatar">
        <span class="repos-account-initial">
          {(user.name || user.login).trim().charAt(0).toUpperCase()}
        </span>
        {user.avatarUrl && (
          <img
            alt=""
            src={user.avatarUrl}
            // Sin `loading="lazy"`: son 26 px y el diferido no llegaba a
            // dispararse nunca dentro del panel, así que la foto no aparecía.
            onLoad={(event) => (event.currentTarget as HTMLImageElement).classList.add("is-ready")}
            ref={(nodo) => {
              // Si venía de la caché, `load` ya pasó y el oyente llega tarde.
              if (nodo?.complete && nodo.naturalWidth > 0) nodo.classList.add("is-ready");
            }}
          />
        )}
      </span>
      <span class="repos-account-text">
        <span class="repos-account-name" id="repos-account-name">{user.name || user.login}</span>
        <span class="repos-account-meta" id="repos-account-meta">{meta}</span>
      </span>
      <span class="repos-account-go" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon("more") }} />
    </button>
  );
}
