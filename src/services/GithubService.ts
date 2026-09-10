import { githubAuthStatus } from "../github.ts";

export interface GithubSession {
  connected: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface GithubService {
  session(): Promise<GithubSession>;
}

export function createGithubService(): GithubService {
  return {
    async session() {
      const status = await githubAuthStatus();
      return {
        connected: status.connected,
        login: status.user?.login ?? null,
        name: status.user?.name ?? null,
        avatarUrl: status.user?.avatarUrl ?? null,
      };
    },
  };
}
