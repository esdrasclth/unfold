/**
 * Historial local de versiones.
 *
 * Guarda hasta treinta copias de cada documento para poder volver atrás cuando
 * el deshacer del editor ya no alcanza. Vive en disco y no en `localStorage`
 * porque treinta copias de un documento grande no caben en la cuota, y lo que
 * pasaba al no caber era peor que no tener historial: escribir fallaba en
 * silencio y la aplicación seguía ofreciendo recuperar versiones que no había.
 */

import { store, type Store } from "./store.ts";

export interface LocalVersion {
  id: string;
  savedAt: number;
  content: string;
}

const MAX = 30;
type Registro = Record<string, LocalVersion[]>;

/**
 * Copia en memoria de lo que hay en disco.
 *
 * Existe porque grabar una versión ocurre al guardar el documento, y ahí no se
 * puede esperar a un viaje al disco antes de decidir si la versión es nueva.
 * Se llena al arrancar y se mantiene al día desde aquí.
 */
let registro: Registro = {};
let cargado = false;
let escrituraPendiente: Promise<void> = Promise.resolve();

export async function loadHistory(desde: Store = store): Promise<void> {
  try {
    const crudo = await desde.read("history");
    registro = crudo ? (JSON.parse(crudo) as Registro) : {};
  } catch {
    // Un historial ilegible no puede impedir abrir la aplicación. Se empieza
    // de cero, que es exactamente lo que había antes de la primera versión.
    registro = {};
  }
  cargado = true;
}

function guardar(en: Store = store): void {
  const contenido = JSON.stringify(registro);
  escrituraPendiente = escrituraPendiente
    .then(() => en.write("history", contenido))
    .catch((error) => {
      // El error queda consumido para que una escritura fallida no bloquee las
      // siguientes. Se conserva la cola y se cuenta el fallo.
      console.error("No se pudo guardar el historial", error);
    });
}

export function recordVersion(documentKey: string, content: string, en: Store = store): void {
  if (!documentKey || !content.trim() || !cargado) return;
  const lista = registro[documentKey] ?? [];
  if (lista[0]?.content === content) return;

  lista.unshift({
    id: crypto.randomUUID?.() ?? `${Date.now()}`,
    savedAt: Date.now(),
    content,
  });
  registro[documentKey] = lista.slice(0, MAX);
  guardar(en);
}

export function versionsFor(documentKey: string): LocalVersion[] {
  return registro[documentKey] ?? [];
}

export function clearHistory(documentKey: string, en: Store = store): void {
  delete registro[documentKey];
  guardar(en);
}

export function historyKey(path: string | null, name: string): string {
  return path ?? `untitled:${name}`;
}

/** Sólo para las pruebas: deja el módulo como recién arrancado. */
export function resetHistory(): void {
  registro = {};
  cargado = false;
  escrituraPendiente = Promise.resolve();
}
