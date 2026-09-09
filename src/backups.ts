import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./files.ts";

const FOLDER_KEY = "unfold:backup-folder";
/** Índice de la versión vieja. Ya no se usa: sólo se limpia al arrancar. */
const INDEX_KEY = "unfold:backup-index";

/** Sólo guarda una ruta, así que aquí `localStorage` está bien. */
export function backupFolder(): string | null {
  return localStorage.getItem(FOLDER_KEY);
}

export function setBackupFolder(path: string | null): void {
  if (path) localStorage.setItem(FOLDER_KEY, path);
  else localStorage.removeItem(FOLDER_KEY);
}

/**
 * Copia el documento a la carpeta elegida y poda las que sobran.
 *
 * Antes esto llevaba su propio índice en `localStorage` recortado a cincuenta
 * entradas mientras escribía archivos que no borraba nunca: pasadas las
 * cincuenta, lo escrito seguía en el disco pero ya nada sabía que existía. Ahora
 * quien poda es Rust mirando la carpeta, que es la única lista que no puede
 * desincronizarse de lo que hay de verdad.
 */
export async function createBackup(key: string, content: string): Promise<void> {
  // Un documento en blanco no es una copia, es perder la que había.
  if (!content) return;

  if (!isTauri) {
    // En el navegador no hay carpeta que elegir: una ranura por documento, y
    // si la cuota está llena se dice, que es justo lo que no se hacía.
    try {
      localStorage.setItem(`unfold:backup:${key}`, content);
    } catch (error) {
      console.warn("No se pudo guardar la copia en el navegador", error);
    }
    return;
  }

  const folder = backupFolder();
  if (!folder) return;
  try {
    await invoke("backup_write", { folder, key, contents: content });
  } catch (error) {
    console.warn("No se pudo crear la copia de seguridad", error);
  }
}

export async function restoreLatest(key: string): Promise<string | null> {
  const folder = backupFolder();
  if (isTauri && folder) {
    try {
      return await invoke<string | null>("backup_latest", { folder, key });
    } catch (error) {
      console.warn("No se pudo leer la copia de seguridad", error);
      return null;
    }
  }
  return localStorage.getItem(`unfold:backup:${key}`);
}

/**
 * Borra los restos de la versión que llevaba índice en `localStorage`.
 *
 * Los archivos que quedaron sueltos en la carpeta no hace falta perseguirlos:
 * llevan el mismo nombre de siempre, así que la primera copia de cada documento
 * los encuentra y los poda.
 */
export function limpiarIndiceViejo(): void {
  localStorage.removeItem(INDEX_KEY);
}
