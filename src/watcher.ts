import { isTauri, readFile } from "./files.ts";

export interface WatchHandlers {
  /** Contenido actual del editor, para distinguir nuestros propios guardados. */
  currentContent: () => string;
  /** ¿Hay cambios sin guardar? Decide entre recargar solo o preguntar. */
  isDirty: () => boolean;
  /** El archivo cambió fuera y podemos adoptarlo sin perder nada. */
  onReload: (content: string) => void;
  /** El archivo cambió fuera pero hay cambios locales: hay conflicto. */
  onConflict: (content: string) => void;
  /** El archivo abierto ha desaparecido o se ha renombrado. */
  onRemoved: () => void;
}

/**
 * Vigila el archivo abierto y avisa cuando cambia fuera de Unfold.
 *
 * Sin esto el autoguardado pisa en silencio lo que hayas editado desde otro
 * programa, que es la única forma que tiene este editor de perder datos.
 */
export class FileWatcher {
  private stop: (() => void) | null = null;
  private watching: string | null = null;
  /** Última vez que escribimos nosotros: sirve para ignorar nuestro eco. */
  private lastSelfWrite = 0;

  constructor(private readonly handlers: WatchHandlers) {}

  /** Marca que el guardado lo hemos hecho nosotros, no un programa externo. */
  noteSelfWrite(): void {
    this.lastSelfWrite = Date.now();
  }

  async watch(path: string | null): Promise<void> {
    if (path === this.watching) return;
    this.close();
    this.watching = path;
    if (!isTauri || !path) return;

    try {
      const { watch } = await import("@tauri-apps/plugin-fs");
      // `watch` es la variante con rebote: un guardado ajeno produce una
      // ráfaga de eventos y sólo queremos reaccionar una vez.
      this.stop = await watch(path, () => void this.check(path), { delayMs: 250 });
    } catch (error) {
      // Sin vigilancia la aplicación sigue siendo usable; no vale interrumpir.
      console.error("No se pudo vigilar el archivo", error);
    }
  }

  private async check(path: string): Promise<void> {
    // Nuestro propio guardado genera un evento: no es un cambio externo.
    if (Date.now() - this.lastSelfWrite < 1500) return;

    let content: string;
    try {
      content = await readFile(path);
    } catch {
      this.handlers.onRemoved();
      return;
    }

    // El contenido puede ser idéntico si sólo cambió la fecha del archivo.
    if (content === this.handlers.currentContent()) return;

    if (this.handlers.isDirty()) this.handlers.onConflict(content);
    else this.handlers.onReload(content);
  }

  close(): void {
    this.stop?.();
    this.stop = null;
    this.watching = null;
  }
}
