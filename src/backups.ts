import { isTauri } from "./files.ts";

const FOLDER_KEY = "unfold:backup-folder";
const INDEX_KEY = "unfold:backup-index";
type Entry = { key: string; path: string; createdAt: number };
function index(): Entry[] { try { return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]"); } catch { return []; } }
export function backupFolder(): string | null { return localStorage.getItem(FOLDER_KEY); }
export function setBackupFolder(path: string | null): void { if (path) localStorage.setItem(FOLDER_KEY, path); else localStorage.removeItem(FOLDER_KEY); }
export async function createBackup(key: string, content: string): Promise<void> {
  if (!content || !isTauri) { localStorage.setItem(`unfold:backup:${key}`, content); return; }
  const folder = backupFolder(); if (!folder) return;
  const safe = key.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${folder.replace(/[\\/]$/, "")}/${safe}-${Date.now()}.md`;
  try {
    const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
    await mkdir(folder, { recursive: true }); await writeTextFile(path, content);
    const entries = [{ key, path, createdAt: Date.now() }, ...index()].slice(0, 50); localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch (error) { console.warn("No se pudo crear la copia de seguridad", error); }
}
export async function restoreLatest(key: string): Promise<string | null> {
  const entry = index().find((item) => item.key === key);
  if (entry && isTauri) { try { const { readTextFile } = await import("@tauri-apps/plugin-fs"); return await readTextFile(entry.path); } catch { return null; } }
  return localStorage.getItem(`unfold:backup:${key}`);
}
