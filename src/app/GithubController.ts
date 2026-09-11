import { isTauri } from "../files.ts";
import { connectedRepositories, type ConnectedRepository } from "../repositories.ts";
import { githubAuthStatus, type GithubAuthStatus } from "../github.ts";

export interface GithubControllerOptions {
  onRepositories(count: number): void;
  onStatus(status: GithubAuthStatus): void;
}

/** Coordina la hidrataciÃ³n silenciosa del estado GitHub de la interfaz. */
export function startGithubController(options: GithubControllerOptions): () => void {
  if (!isTauri) return () => {};
  const timer = window.setTimeout(() => {
    void githubAuthStatus().then(options.onStatus).catch(() => {});
  }, 4500);
  void connectedRepositories()
    .then((repositories: ConnectedRepository[]) => options.onRepositories(repositories.length))
    .catch(() => {});
  return () => window.clearTimeout(timer);
}
