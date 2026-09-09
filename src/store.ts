/**
 * Estado que sobrevive al cierre: historial de versiones y sesión.
 *
 * Vivía en `localStorage` y ahí no cabe. Treinta copias de un documento de
 * diez mil líneas son catorce megas contra una cuota de cinco, y al llenarse
 * `history.ts` se tragaba el error: la aplicación seguía ofreciendo «recuperar
 * versión» sin tener ninguna. La sesión compartía esa cuota, así que un
 * documento grande podía impedir guardar los borradores sin guardar.
 *
 * En el escritorio va a disco, un archivo por cosa, con escritura atómica. En
 * el navegador —`npm run dev`— sigue en `localStorage`, que es lo único que
 * hay allí; y allí los documentos de prueba son pequeños.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./files.ts";

export type StoreName = "history" | "session";

const CLAVE_ANTIGUA: Record<StoreName, string> = {
  history: "unfold:history",
  session: "unfold:session",
};

export interface Store {
  read(name: StoreName): Promise<string | null>;
  write(name: StoreName, contents: string): Promise<void>;
  clear(name: StoreName): Promise<void>;
}

const enDisco: Store = {
  read: (name) => invoke<string | null>("store_read", { name }),
  write: async (name, contents) => {
    await invoke("store_write", { name, contents });
  },
  clear: async (name) => {
    await invoke("store_clear", { name });
  },
};

const enNavegador: Store = {
  read: async (name) => localStorage.getItem(CLAVE_ANTIGUA[name]),
  write: async (name, contents) => localStorage.setItem(CLAVE_ANTIGUA[name], contents),
  clear: async (name) => localStorage.removeItem(CLAVE_ANTIGUA[name]),
};

export const store: Store = isTauri ? enDisco : enNavegador;

/**
 * Sube a disco lo que hubiera quedado en `localStorage`.
 *
 * Se hace una vez, al arrancar, y sólo si en disco no hay nada: nadie debe
 * perder su historial por actualizar. La clave vieja se borra después, que es
 * además lo que libera la cuota que estaba causando el problema.
 */
export async function migrarDesdeLocalStorage(destino: Store = store): Promise<void> {
  if (!isTauri) return;
  for (const name of ["history", "session"] as StoreName[]) {
    const viejo = localStorage.getItem(CLAVE_ANTIGUA[name]);
    if (viejo === null) continue;
    try {
      if ((await destino.read(name)) === null) await destino.write(name, viejo);
      localStorage.removeItem(CLAVE_ANTIGUA[name]);
    } catch (error) {
      // Si la subida falla se deja donde estaba: mejor un historial en la
      // cuota vieja que ningún historial.
      console.error(`No se pudo migrar ${name} a disco`, error);
    }
  }
}
