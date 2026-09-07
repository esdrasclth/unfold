const KEY = "unfold:recent";
const LIMIT = 12;

export interface RecentFile {
  path: string;
  name: string;
  /** Milisegundos, para ordenar y para mostrar cuándo se abrió. */
  opened: number;
}

export function loadRecent(): RecentFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentFile[];
    return Array.isArray(list) ? list.filter((item) => typeof item?.path === "string") : [];
  } catch {
    return [];
  }
}

/** Apunta un archivo como recién usado y lo pone el primero. */
export function rememberRecent(path: string, name: string): RecentFile[] {
  // Se filtra por ruta antes de insertar: reabrir un archivo no debe dejar dos
  // entradas iguales, sólo moverlo al principio.
  const list = [{ path, name, opened: Date.now() }, ...loadRecent().filter((r) => r.path !== path)];
  const trimmed = list.slice(0, LIMIT);
  localStorage.setItem(KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function forgetRecent(path: string): RecentFile[] {
  const list = loadRecent().filter((item) => item.path !== path);
  localStorage.setItem(KEY, JSON.stringify(list));
  return list;
}

/** Carpeta que contiene el archivo, para distinguir homónimos en la lista. */
export function folderOf(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts[parts.length - 1] ?? "";
}

/** «hace un momento», «hace 3 h», «12 mar». */
export function whenLabel(opened: number): string {
  const minutes = Math.round((Date.now() - opened) / 60000);
  if (minutes < 2) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;

  return new Date(opened).toLocaleDateString("es", { day: "numeric", month: "short" });
}
