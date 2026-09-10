import {
  githubAuthStatus,
  githubInstallationState,
  listGithubRepositories,
  logoutGithub,
  openGithubUrl,
  pollGithubDeviceFlow,
  startGithubDeviceFlow,
  type DeviceAuthorization,
  type GithubAuthStatus,
  type GithubRepository,
  type InstallationState,
} from "../github.ts";
import {
  connectRepository,
  connectedRepositories,
  disconnectRepository,
  fetchRepository,
  onCloneProgress,
  repositoryDocuments,
  touchRepository,
  advanceMessage,
  type ConnectedRepository,
  type RepositoryDocument,
} from "../repositories.ts";
import { confirmDialog } from "../ui/confirmDialog.ts";
import { isTauri } from "../files.ts";

const DESCONECTADO: GithubAuthStatus = { connected: false, user: null, expiresAt: null };

/** Cuánto dura un aviso dentro del diálogo antes de irse solo. */
const AVISO_MS = 6000;

export interface GithubDialogOptions {
  onOpenDocument?: (path: string, name: string) => void;
  onStatusChange?: (status: GithubAuthStatus) => void;
  onRepositoriesChange?: (count: number) => void;
  /** Cerrar el diálogo entero; lo pone quien lo monta. */
  onClose?: () => void;
}

export type GithubView = "loading" | "error" | "authorize" | "list";

export interface GithubData {
  view: GithubView;
  /** Qué se está haciendo, mientras `view` es `loading`. */
  message: string;
  /** El fallo que llenó la pantalla, mientras `view` es `error`. */
  error: string;
  authorization: DeviceAuthorization | null;
  /** Se pone al copiar el código, para decirlo debajo. */
  codeCopied: boolean;
  status: GithubAuthStatus;
  granted: GithubRepository[];
  grantedError: string | null;
  connected: ConnectedRepository[];
  connectedError: string | null;
  installation: InstallationState | null;
  expanded: ReadonlySet<number>;
  documents: ReadonlyMap<number, RepositoryDocument[]>;
  /** Lo que está en marcha en cada repositorio, para deshabilitar y contarlo. */
  busy: ReadonlyMap<number, string>;
  menuOpen: boolean;
  notice: string | null;
}

function mensajeDe(error: unknown): string {
  if (typeof error === "string") return error;
  return error instanceof Error ? error.message : "No se pudo completar la operación";
}

function nombreDe(relative: string): string {
  return relative.split("/").pop() ?? relative;
}

/**
 * El estado del diálogo de GitHub y todo lo que tarda.
 *
 * Aquí viven la red, el sondeo del flujo de dispositivo, el progreso del clone
 * y los temporizadores; la vista sólo recibe lo que salga. Es el mismo reparto
 * que en el explorador, y aquí importa más: éste es el único sitio de la
 * aplicación que sondea, y un sondeo que sobrevive al diálogo sigue pidiendo a
 * GitHub para siempre.
 *
 * `dispose()` corta todo de una vez —el temporizador del sondeo, el del aviso,
 * la escucha del progreso y la del regreso del navegador—, y cada respuesta
 * comprueba su generación antes de escribir, así que lo que llegue tarde se
 * descarta en vez de pintar sobre un diálogo que ya no existe.
 */
export class GithubDialogController {
  private data: GithubData = {
    view: "loading",
    message: "Comprobando GitHub…",
    error: "",
    authorization: null,
    codeCopied: false,
    status: DESCONECTADO,
    granted: [],
    grantedError: null,
    connected: [],
    connectedError: null,
    installation: null,
    expanded: new Set(),
    documents: new Map(),
    busy: new Map(),
    menuOpen: false,
    notice: null,
  };

  private readonly options: GithubDialogOptions;
  private readonly listeners = new Set<(data: GithubData) => void>();

  private cerrado = false;
  private sondeo: number | undefined;
  private generacionSondeo = 0;
  private temporizadorAviso: number | undefined;
  private soltarProgreso: (() => void) | null = null;
  /** Se mandó a alguien a GitHub y hay que releer cuando vuelva. */
  private esperandoRegreso = false;
  private reintento: (() => void) | null = null;

  constructor(options: GithubDialogOptions = {}) {
    this.options = options;
    window.addEventListener("focus", this.alVolver);
  }

  subscribe(listener: (data: GithubData) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): GithubData {
    return this.data;
  }

  private set(cambio: Partial<GithubData>): void {
    this.data = { ...this.data, ...cambio };
    for (const listener of this.listeners) listener(this.data);
  }

  /** Empieza. Sin escritorio no hay nada que intentar. */
  start(): void {
    if (!isTauri) {
      this.fallar("La conexión con GitHub requiere la aplicación de escritorio.", null);
      return;
    }
    void this.load();
  }

  dispose(): void {
    if (this.cerrado) return;
    this.cerrado = true;
    this.generacionSondeo += 1;
    window.clearTimeout(this.sondeo);
    window.clearTimeout(this.temporizadorAviso);
    this.soltarProgreso?.();
    this.soltarProgreso = null;
    window.removeEventListener("focus", this.alVolver);
    this.listeners.clear();
  }

  // --- Vistas ---------------------------------------------------------------

  private cargando(message: string): void {
    this.set({ view: "loading", message });
  }

  private fallar(error: unknown, reintento: (() => void) | null): void {
    this.reintento = reintento;
    this.set({ view: "error", error: mensajeDe(error) });
  }

  reintentar(): void {
    (this.reintento ?? (() => void this.load()))();
  }

  // --- Autorización ---------------------------------------------------------

  beginAuthorization = async (): Promise<void> => {
    this.cargando("Preparando autorización…");
    try {
      const authorization = await startGithubDeviceFlow();
      if (this.cerrado) return;
      this.set({ view: "authorize", authorization, codeCopied: false });

      const generacion = ++this.generacionSondeo;
      const caduca = Date.now() + authorization.expiresIn * 1000;
      let espera = Math.max(authorization.interval, 5) * 1000;

      const sondear = async (): Promise<void> => {
        if (this.cerrado || generacion !== this.generacionSondeo) return;
        if (Date.now() >= caduca) {
          this.fallar("El código caducó. Solicita uno nuevo.", () => void this.beginAuthorization());
          return;
        }
        try {
          const resultado = await pollGithubDeviceFlow(authorization.deviceCode);
          if (this.cerrado || generacion !== this.generacionSondeo) return;
          if (resultado.state === "authorized") {
            await this.load();
            return;
          }
          if (resultado.state === "expired") {
            this.fallar("El código caducó. Solicita uno nuevo.", () => void this.beginAuthorization());
            return;
          }
          if (resultado.state === "denied") {
            this.fallar("La autorización fue cancelada en GitHub.", () => void this.beginAuthorization());
            return;
          }
          if (resultado.state === "slow_down") espera += 5_000;
          if (resultado.retryAfter > 0) espera = Math.max(espera, resultado.retryAfter * 1000);
          this.sondeo = window.setTimeout(() => void sondear(), espera);
        } catch (error) {
          this.fallar(error, () => void this.beginAuthorization());
        }
      };
      this.sondeo = window.setTimeout(() => void sondear(), espera);
    } catch (error) {
      this.fallar(error, () => void this.beginAuthorization());
    }
  };

  copyCode = async (): Promise<void> => {
    const codigo = this.data.authorization?.userCode;
    if (!codigo) return;
    await navigator.clipboard.writeText(codigo);
    if (!this.cerrado) this.set({ codeCopied: true });
  };

  openAuthorizationPage = (): void => {
    const uri = this.data.authorization?.verificationUri;
    if (uri) void openGithubUrl(uri).catch((error) => this.fallar(error, () => void this.load()));
  };

  // --- El menú de la cuenta -------------------------------------------------

  toggleMenu = (open = !this.data.menuOpen): void => {
    this.set({ menuOpen: open });
  };

  openManage = (): void => {
    this.set({ menuOpen: false });
    // La página de esta instalación cuando se sabe cuál es; el listado general
    // sólo como respaldo.
    void openGithubUrl(
      this.data.installation?.configureUrl ?? "https://github.com/settings/installations",
    );
    this.esperandoRegreso = true;
  };

  openAccess = (): void => {
    const url = this.data.installation?.configureUrl;
    if (!url) return;
    void openGithubUrl(url);
    // Al volver del navegador la lista se relee sola, así que no hace falta
    // decirle a nadie que pulse actualizar.
    this.esperandoRegreso = true;
  };

  // --- Acciones -------------------------------------------------------------

  openDocument = (repository: ConnectedRepository, document: RepositoryDocument): void => {
    this.options.onOpenDocument?.(document.path, nombreDe(document.relative));
    void touchRepository(repository.id);
    this.options.onClose?.();
  };

  openInGithub = (repository: ConnectedRepository): void => {
    void openGithubUrl(`https://github.com/${repository.fullName}`);
  };

  toggleDocuments = async (repository: ConnectedRepository): Promise<void> => {
    const expanded = new Set(this.data.expanded);
    if (expanded.delete(repository.id)) {
      this.set({ expanded });
      return;
    }
    expanded.add(repository.id);
    this.set({ expanded });
    if (this.data.documents.has(repository.id)) return;

    try {
      const encontrados = await repositoryDocuments(repository.id);
      if (this.cerrado) return;
      this.set({ documents: new Map(this.data.documents).set(repository.id, encontrados) });
    } catch (error) {
      if (this.cerrado) return;
      const sinEl = new Set(this.data.expanded);
      sinEl.delete(repository.id);
      this.set({ expanded: sinEl, connectedError: mensajeDe(error) });
    }
  };

  connect = async (repository: GithubRepository): Promise<void> => {
    this.marcar(repository.id, "Preparando…");

    // El progreso llega por evento desde Rust. Se engancha sólo mientras dura
    // el clone y se suelta al terminar, pase lo que pase.
    this.soltarProgreso?.();
    this.soltarProgreso = await onCloneProgress((progreso) => {
      if (progreso.id !== repository.id) return;
      const porcentaje =
        progreso.total > 0 ? Math.round((progreso.received / progreso.total) * 100) : 0;
      this.marcar(repository.id, `Clonando… ${porcentaje}%`);
    });

    try {
      await connectRepository(repository.id);
      if (this.cerrado) return;
      const documents = new Map(this.data.documents);
      documents.delete(repository.id);
      this.set({ documents });
      await this.refreshCatalog();
    } catch (error) {
      if (this.cerrado) return;
      this.set({ connectedError: mensajeDe(error) });
    } finally {
      this.soltarProgreso?.();
      this.soltarProgreso = null;
      this.desmarcar(repository.id);
    }
  };

  bringChanges = async (repository: ConnectedRepository): Promise<void> => {
    this.marcar(repository.id, "Trayendo cambios…");
    try {
      const informe = await fetchRepository(repository.id);
      if (this.cerrado) return;
      // El contenido pudo cambiar por debajo: la lista de documentos que
      // hubiera en pantalla ya no vale.
      const documents = new Map(this.data.documents);
      documents.delete(repository.id);
      this.set({ documents, connectedError: null });
      await this.refreshCatalog();
      if (!this.cerrado) this.avisar(advanceMessage(informe.advance, repository.fullName));
    } catch (error) {
      if (this.cerrado) return;
      this.set({ connectedError: mensajeDe(error) });
    } finally {
      this.desmarcar(repository.id);
    }
  };

  disconnect = async (repository: ConnectedRepository): Promise<void> => {
    const eleccion = await confirmDialog(
      "Desconectar repositorio",
      `«${repository.fullName}» dejará de aparecer en Unfold. Su copia local puede quedarse en el disco o borrarse; borrarla no toca nada en GitHub.`,
      [
        { label: "Cancelar", cancel: true, value: "cancel" },
        { label: "Desconectar y conservar la copia", primary: true, value: "keep" },
        { label: "Desconectar y borrar la copia", value: "delete" },
      ],
    );
    if (eleccion !== "keep" && eleccion !== "delete") return;

    this.marcar(repository.id, "Desconectando…");
    try {
      await disconnectRepository(repository.id, eleccion === "delete");
      if (this.cerrado) return;
      const expanded = new Set(this.data.expanded);
      expanded.delete(repository.id);
      const documents = new Map(this.data.documents);
      documents.delete(repository.id);
      this.set({ expanded, documents, connectedError: null });
      await this.refreshCatalog();
    } catch (error) {
      if (this.cerrado) return;
      this.set({ connectedError: mensajeDe(error) });
    } finally {
      this.desmarcar(repository.id);
    }
  };

  signOut = async (): Promise<void> => {
    this.set({ menuOpen: false });
    const eleccion = await confirmDialog(
      "Cerrar sesión de GitHub",
      "Se eliminará la credencial de este equipo. Los repositorios ya clonados siguen en el disco y se pueden seguir abriendo. La GitHub App seguirá instalada hasta que la revoques en GitHub.",
      [
        { label: "Cancelar", cancel: true, value: "cancel" },
        { label: "Cerrar sesión", primary: true, value: "logout" },
      ],
    );
    if (eleccion !== "logout") return;
    try {
      await logoutGithub();
      if (this.cerrado) return;
      this.set({ status: DESCONECTADO, granted: [], grantedError: null });
      this.options.onStatusChange?.(DESCONECTADO);
    } catch (error) {
      if (!this.cerrado) this.fallar(error, () => void this.load());
    }
  };

  // --- Lectura --------------------------------------------------------------

  private async refreshCatalog(): Promise<void> {
    try {
      const connected = await connectedRepositories();
      connected.sort((left, right) => left.fullName.localeCompare(right.fullName));
      this.set({ connected });
      this.options.onRepositoriesChange?.(connected.length);
    } catch (error) {
      this.set({ connectedError: mensajeDe(error) });
    }
  }

  async load(): Promise<void> {
    this.cargando("Comprobando GitHub…");
    this.set({ connectedError: null, grantedError: null });

    // El catálogo primero: es local, no puede fallar por red y es lo que hace
    // que los repositorios sigan estando ahí sin sesión.
    await this.refreshCatalog();
    if (this.cerrado) return;

    try {
      this.set({ status: await githubAuthStatus() });
    } catch (error) {
      this.set({ status: DESCONECTADO, grantedError: mensajeDe(error) });
    }
    if (this.cerrado) return;
    this.options.onStatusChange?.(this.data.status);

    await this.refreshAccess();
  }

  /**
   * Relee lo que GitHub concede: la instalación y sus repositorios.
   *
   * Va aparte de `load` porque también se llama al volver del navegador, y ahí
   * no debe reaparecer la pantalla de carga: quien acaba de cambiar la
   * selección espera encontrarse la lista nueva, no un rótulo.
   */
  async refreshAccess(): Promise<void> {
    if (!this.data.status.connected) {
      this.set({ view: "list", granted: [], installation: null });
      return;
    }
    try {
      const [installation, granted] = await Promise.all([
        githubInstallationState(),
        listGithubRepositories(),
      ]);
      if (this.cerrado) return;
      this.set({ view: "list", installation, granted, grantedError: null });
    } catch (error) {
      if (this.cerrado) return;
      this.set({ view: "list", granted: [], grantedError: mensajeDe(error) });
    }
  }

  /*
   * Cambiar los repositorios ocurre en el navegador, fuera de aquí. Al
   * recuperar el foco se relee, así que la lista nueva está esperando cuando
   * la persona vuelve y nadie tiene que acordarse de pulsar actualizar.
   */
  private alVolver = (): void => {
    if (!this.esperandoRegreso || this.cerrado) return;
    this.esperandoRegreso = false;
    void this.refreshAccess();
  };

  // --- Cosas pequeñas -------------------------------------------------------

  private marcar(id: number, texto: string): void {
    this.set({ busy: new Map(this.data.busy).set(id, texto) });
  }

  private desmarcar(id: number): void {
    if (this.cerrado) return;
    const busy = new Map(this.data.busy);
    busy.delete(id);
    this.set({ busy });
  }

  /** Aviso breve dentro del diálogo, para lo que no merece cambiar de vista. */
  private avisar(notice: string): void {
    window.clearTimeout(this.temporizadorAviso);
    this.set({ notice });
    this.temporizadorAviso = window.setTimeout(() => {
      if (!this.cerrado) this.set({ notice: null });
    }, AVISO_MS);
  }
}
