import {
  commitIdentity,
  onPublishProgress,
  publish,
  pushPending,
  repositoryChanges,
  repositoryDiff,
  PUBLISH_PHASE_LABEL,
  type Change,
  type ConnectedRepository,
  type Identity,
  type PublishReport,
  type RepositoryDiff,
} from "../repositories.ts";

const NOREPLY_KEY = "unfold:github-noreply";

export interface CommitDialogOptions {
  onChanged?: () => void;
  notify?: (message: string) => void;
  /** Cerrar el diálogo entero; lo pone quien lo monta. */
  onClose?: () => void;
}

export interface CommitData {
  loading: boolean;
  changes: Change[];
  selected: ReadonlySet<string>;
  /** Diffs ya leídos, por ruta; el recuento sale de aquí aunque estén plegados. */
  diffs: ReadonlyMap<string, RepositoryDiff>;
  /** Rutas con el diff desplegado. */
  open: ReadonlySet<string>;
  /** Rutas cuyo diff se está leyendo, y con qué texto decirlo. */
  loadingDiff: ReadonlyMap<string, string>;
  /** Fallo al leer el diff de una ruta concreta. */
  diffError: ReadonlyMap<string, string>;
  identity: Identity | null;
  identityProblem: string | null;
  forceNoreply: boolean;
  message: string;
  /** Qué se está haciendo; mientras haya algo, no se puede cerrar ni tocar. */
  working: string | null;
  problem: string | null;
  report: PublishReport | null;
}

function mensajeDe(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "No se pudo completar la operación";
}

/**
 * El estado de la vista de cambios y todo lo que sale a la red.
 *
 * Los tres pasos —elegir, describir y publicar— caben en una sola pantalla a
 * propósito: separarlos en un asistente obligaría a recordar lo que se marcó
 * mientras se escribe el mensaje, que es justo cuando hace falta tenerlo
 * delante.
 *
 * Publicar son tres pasos y dos salen a la red, así que el avance llega por
 * evento desde Rust y se cuenta en `working`. El oyente se suelta pase lo que
 * pase: cerrarlo es limpieza, no parte del resultado.
 */
export class CommitDialogController {
  private data: CommitData;
  private readonly repository: ConnectedRepository;
  private readonly options: CommitDialogOptions;
  private readonly listeners = new Set<(data: CommitData) => void>();
  private cerrado = false;

  constructor(repository: ConnectedRepository, options: CommitDialogOptions = {}) {
    this.repository = repository;
    this.options = options;
    this.data = {
      loading: true,
      changes: [],
      selected: new Set(),
      diffs: new Map(),
      open: new Set(),
      loadingDiff: new Map(),
      diffError: new Map(),
      identity: null,
      identityProblem: null,
      forceNoreply: localStorage.getItem(NOREPLY_KEY) === "on",
      message: "",
      working: null,
      problem: null,
      report: null,
    };
  }

  subscribe(listener: (data: CommitData) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): CommitData {
    return this.data;
  }

  private set(cambio: Partial<CommitData>): void {
    this.data = { ...this.data, ...cambio };
    for (const listener of this.listeners) listener(this.data);
  }

  dispose(): void {
    this.cerrado = true;
    this.listeners.clear();
  }

  /** Con algo en marcha no se cierra: publicar a medias no se puede deshacer. */
  get busy(): boolean {
    return this.data.working !== null;
  }

  canPublish(): boolean {
    const { working, selected, message, identity } = this.data;
    return !working && selected.size > 0 && message.trim().length > 0 && identity !== null;
  }

  // --- Elegir ---------------------------------------------------------------

  toggle = (relative: string): void => {
    const selected = new Set(this.data.selected);
    if (!selected.delete(relative)) selected.add(relative);
    this.set({ selected });
  };

  toggleAll = (): void => {
    const todos = this.data.selected.size === this.data.changes.length;
    this.set({
      selected: todos ? new Set() : new Set(this.data.changes.map((change) => change.relative)),
    });
  };

  setMessage = (message: string): void => {
    this.set({ message });
  };

  setNoreply = (forceNoreply: boolean): void => {
    localStorage.setItem(NOREPLY_KEY, forceNoreply ? "on" : "off");
    this.set({ forceNoreply });
    void this.loadIdentity();
  };

  // --- Diffs ----------------------------------------------------------------

  toggleDiff = (change: Change): void => {
    const open = new Set(this.data.open);
    if (open.delete(change.relative)) {
      this.set({ open });
      return;
    }
    open.add(change.relative);
    this.set({ open });
    if (!this.data.diffs.has(change.relative)) void this.loadDiff(change, false);
  };

  loadDiff = async (change: Change, expanded: boolean): Promise<void> => {
    this.marcarDiff(
      change.relative,
      expanded ? "Ampliando vista previa…" : "Preparando vista previa…",
    );
    try {
      const diff = await repositoryDiff(this.repository.id, change.relative, expanded);
      if (this.cerrado) return;
      /*
       * La huella pertenece al contenido que acaba de mostrarse. Si el archivo
       * cambió desde que se abrió el diálogo, ésta sustituye a la instantánea
       * inicial y publicar validará exactamente el diff que se revisó.
       */
      change.fingerprint = diff.fingerprint;
      const diffError = new Map(this.data.diffError);
      diffError.delete(change.relative);
      this.set({ diffs: new Map(this.data.diffs).set(change.relative, diff), diffError });
    } catch (error) {
      if (this.cerrado) return;
      this.set({
        diffError: new Map(this.data.diffError).set(change.relative, mensajeDe(error)),
      });
    } finally {
      this.desmarcarDiff(change.relative);
    }
  };

  private marcarDiff(relative: string, texto: string): void {
    this.set({ loadingDiff: new Map(this.data.loadingDiff).set(relative, texto) });
  }

  private desmarcarDiff(relative: string): void {
    if (this.cerrado) return;
    const loadingDiff = new Map(this.data.loadingDiff);
    loadingDiff.delete(relative);
    this.set({ loadingDiff });
  }

  // --- Datos ----------------------------------------------------------------

  async load(): Promise<void> {
    await this.refreshChanges(false);
    await this.loadIdentity();
  }

  private async loadIdentity(): Promise<void> {
    try {
      const identity = await commitIdentity(this.data.forceNoreply);
      if (this.cerrado) return;
      this.set({ identity, identityProblem: null });
    } catch (error) {
      if (this.cerrado) return;
      this.set({ identity: null, identityProblem: mensajeDe(error) });
    }
  }

  refreshChanges = async (preserveSelection: boolean): Promise<void> => {
    const previas = new Set(this.data.selected);
    this.set({
      working: preserveSelection ? "Actualizando cambios…" : "Buscando cambios…",
      problem: null,
      loading: !preserveSelection,
    });
    try {
      const changes = await repositoryChanges(this.repository.id);
      if (this.cerrado) return;
      const selected = new Set<string>();
      for (const change of changes) {
        // La primera carga marca todo. Una recuperación conserva la decisión
        // anterior y nunca añade silenciosamente archivos aparecidos después.
        if (!preserveSelection || previas.has(change.relative)) selected.add(change.relative);
      }
      this.set({ changes, selected, diffs: new Map(), open: new Set() });
    } catch (error) {
      if (this.cerrado) return;
      this.set({ problem: mensajeDe(error) });
    } finally {
      if (!this.cerrado) this.set({ working: null, loading: false });
    }
  };

  // --- Publicar -------------------------------------------------------------

  private finish(report: PublishReport): void {
    this.options.onChanged?.();
    if (report.pushed) this.options.notify?.(`Publicado en ${this.repository.fullName}`);
    this.set({ report });
  }

  run = async (): Promise<void> => {
    this.set({ working: PUBLISH_PHASE_LABEL.committing, problem: null });

    /*
     * Se espera al oyente antes de arrancar: cuesta un tic y evita la carrera
     * de que el primer paso ocurra antes de que haya nadie escuchando. Si
     * registrarlo falla se publica igual: el avance es una cortesía, y quedarse
     * sin publicar por no poder contarlo sería un mal negocio.
     */
    let soltar: () => void | Promise<void> = () => {};
    try {
      soltar = await onPublishProgress((progreso) => {
        if (this.cerrado || progreso.id !== this.repository.id) return;
        this.set({ working: PUBLISH_PHASE_LABEL[progreso.phase] });
      });
    } catch (error) {
      console.warn("No se pudo seguir el avance de la publicación", error);
    }

    try {
      const revisados = this.data.changes
        .filter((change) => this.data.selected.has(change.relative))
        .map(({ relative, fingerprint }) => ({ relative, fingerprint }));
      this.finish(
        await publish(this.repository.id, revisados, this.data.message, this.data.forceNoreply),
      );
    } catch (error) {
      if (this.cerrado) return;
      this.set({ problem: mensajeDe(error) });
    } finally {
      // Cerrar el oyente es limpieza, no parte del resultado: si falla, la
      // publicación ya ocurrió y su informe no se toca.
      try {
        await soltar();
      } catch (error) {
        console.warn("No se pudo cerrar el oyente de avance", error);
      }
      if (!this.cerrado) this.set({ working: null });
    }
  };

  /**
   * Publica lo que ya está confirmado.
   *
   * Reintentar no vuelve a confirmar: repetir el commit apilaría uno vacío
   * encima del que ya existe.
   */
  retryPush = async (): Promise<void> => {
    this.set({ working: "Publicando…", report: null, problem: null });
    try {
      this.finish(await pushPending(this.repository.id));
    } catch (error) {
      if (this.cerrado) return;
      this.set({ problem: mensajeDe(error) });
    } finally {
      if (!this.cerrado) this.set({ working: null });
    }
  };
}
