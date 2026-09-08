import type { TabSnapshot } from "./tabs.ts";

const STORAGE_KEY = "unfold:session";
const FORMAT_VERSION = 1;

interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionSnapshot {
  version: number;
  active: number;
  tabs: TabSnapshot[];
}

export function saveSession(
  snapshot: Omit<SessionSnapshot, "version">,
  storage: SessionStorage = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, version: FORMAT_VERSION }));
  } catch (error) {
    console.warn("No se pudo guardar la sesión", error);
  }
}

export function loadSession(storage: SessionStorage = localStorage): SessionSnapshot | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SessionSnapshot>;
    if (value.version !== FORMAT_VERSION || !Array.isArray(value.tabs)) return null;
    const tabs = value.tabs.filter((tab): tab is TabSnapshot =>
      typeof tab === "object" && tab !== null &&
      typeof tab.name === "string" && typeof tab.content === "string" &&
      (typeof tab.path === "string" || tab.path === null) &&
      typeof tab.dirty === "boolean" && typeof tab.anchor === "number" &&
      typeof tab.head === "number" && typeof tab.scrollTop === "number",
    );
    return tabs.length ? { version: FORMAT_VERSION, active: Number(value.active) || 0, tabs } : null;
  } catch {
    return null;
  }
}

export function clearSession(storage: SessionStorage = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
