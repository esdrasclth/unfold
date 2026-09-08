export interface LocalVersion { id: string; savedAt: number; content: string; }
const KEY = "unfold:history";
const MAX = 30;
type Store = Record<string, LocalVersion[]>;
function read(): Store { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } }
function write(store: Store): void { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* cuota llena */ } }
export function recordVersion(documentKey: string, content: string): void {
  if (!documentKey || !content.trim()) return;
  const store = read(); const list = store[documentKey] ?? [];
  if (list[0]?.content === content) return;
  list.unshift({ id: crypto.randomUUID?.() ?? `${Date.now()}`, savedAt: Date.now(), content });
  store[documentKey] = list.slice(0, MAX); write(store);
}
export function versionsFor(documentKey: string): LocalVersion[] { return read()[documentKey] ?? []; }
export function clearHistory(documentKey: string): void { const store = read(); delete store[documentKey]; write(store); }
export function historyKey(path: string | null, name: string): string { return path ?? `untitled:${name}`; }
