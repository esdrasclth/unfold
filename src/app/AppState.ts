export interface TabSummary {
  id: number;
  name: string;
  path: string | null;
  dirty: boolean;
}

export interface GithubUiState {
  connected: boolean;
  busy: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface Notice {
  kind: "info" | "success" | "error";
  message: string;
}

export interface AppState {
  tabs: TabSummary[];
  activeTabId: number;
  document: {
    name: string;
    path: string | null;
    dirty: boolean;
    conflict: boolean;
  };
  panels: {
    outline: boolean;
    repositories: boolean;
    settings: boolean;
  };
  github: GithubUiState;
  notice: Notice | null;
}

export function initialAppState(): AppState {
  return {
    tabs: [],
    activeTabId: 0,
    document: { name: "Sin título", path: null, dirty: false, conflict: false },
    panels: { outline: false, repositories: false, settings: false },
    github: { connected: false, busy: false, login: null, name: null, avatarUrl: null },
    notice: null,
  };
}
