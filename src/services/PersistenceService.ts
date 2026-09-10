import { clearSession, loadSession, saveSessionOrThrow } from "../session.ts";

export interface PersistedTab {
  path: string | null;
  name: string;
  dirty: boolean;
  content: string;
  anchor: number;
  head: number;
  scrollTop: number;
}

export interface PersistedWorkspace {
  tabs: PersistedTab[];
  active: number;
}

export interface PersistenceService {
  load(): Promise<PersistedWorkspace | null>;
  save(workspace: PersistedWorkspace): Promise<void>;
}

export function createPersistenceService(): PersistenceService {
  return {
    async load() {
      const session = await loadSession();
      return session ? { tabs: session.tabs, active: session.active } : null;
    },
    async save(workspace) {
      if (workspace.tabs.length === 0) await clearSession();
      else await saveSessionOrThrow(workspace);
    },
  };
}
