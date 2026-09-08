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

interface WatchIO {
  enabled: boolean;
  read: (path: string) => Promise<string>;
  watch: (path: string, callback: () => void) => Promise<() => void>;
}

const nativeIO: WatchIO = {
  enabled: isTauri,
  read: readFile,
  watch: async (path, callback) => {
    const { watch } = await import("@tauri-apps/plugin-fs");
    return watch(path, callback, { delayMs: 250 });
  },
};

/**
 * Vigila el archivo abierto y avisa cuando cambia fuera de Unfold.
 *
 * Sin esto el autoguardado pisa en silencio lo que hayas editado desde otro
 * programa, que es la única forma que tiene este editor de perder datos.
 */
export class FileWatcher {
  private stop: (() => void) | null = null;
  private watching: string | null = null;
  private generation = 0;
  private lastSelfContent: string | null = null;

  private readonly handlers: WatchHandlers;
  private readonly io: WatchIO;

  constructor(handlers: WatchHandlers, io: WatchIO = nativeIO) {
    this.handlers = handlers;
    this.io = io;
  }

  /** Marca que el guardado lo hemos hecho nosotros, no un programa externo. */
  noteSelfWrite(content: string): void {
    this.lastSelfContent = content;
  }

  async watch(path: string | null): Promise<void> {
    if (path === this.watching) return;
    this.close();
    this.watching = path;
    const generation = this.generation;
    if (!this.io.enabled || !path) return;

    try {
      // `watch` es la variante con rebote: un guardado ajeno produce una
      // ráfaga de eventos y sólo queremos reaccionar una vez.
      const stop = await this.io.watch(path, () => void this.check(path, generation));
      if (generation !== this.generation) stop();
      else {
        this.stop = stop;
        await this.check(path, generation);
      }
    } catch (error) {
      // Sin vigilancia la aplicación sigue siendo usable; no vale interrumpir.
      console.error("No se pudo vigilar el archivo", error);
    }
  }

  private async check(path: string, generation: number): Promise<void> {
    if (generation !== this.generation) return;

    let content: string;
    try {
      content = await this.io.read(path);
    } catch {
      if (generation !== this.generation) return;
      this.handlers.onRemoved();
      return;
    }

    if (generation !== this.generation) return;
    if (content === this.lastSelfContent) return;
    this.lastSelfContent = null;
    // El contenido puede ser idéntico si sólo cambió la fecha del archivo.
    if (content === this.handlers.currentContent()) return;

    if (this.handlers.isDirty()) this.handlers.onConflict(content);
    else this.handlers.onReload(content);
  }

  close(): void {
    this.generation++;
    this.lastSelfContent = null;
    this.stop?.();
    this.stop = null;
    this.watching = null;
  }
}
