import type { GithubAuthStatus } from "../github.ts";
import { closeFolder } from "../folders.ts";
import { touchRepository, type ConnectedRepository } from "../repositories.ts";
import {
  RepositoryController,
  type RepositoryControllerOptions,
  type RepositoryData,
} from "../repositories/RepositoryController.ts";
import { mountComponent, type MountedComponent } from "../components/mountComponent.ts";
import {
  RepositoryPanel as RepositoryPanelView,
  type RepositoryPanelProps,
} from "../components/repositories/RepositoryPanel.tsx";
import { nameOf } from "../components/repositories/tree.ts";

const WIDTH_KEY = "unfold:repositories-width";
const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 190;
const MAX_WIDTH = 460;

export interface RepositoryPanelOptions extends RepositoryControllerOptions {
  /** Abre un documento del explorador en el editor. */
  onOpen: (path: string, name: string) => void;
  /** Lleva al diálogo de GitHub desde el pie. */
  onManage: () => void;
  /** Abre la revisión de cambios de un repositorio. */
  onPublish: (repository: ConnectedRepository) => void;
  /** Crea un documento nuevo dentro del repositorio. */
  onCreate: (repository: ConnectedRepository) => void;
  /** Añade una carpeta del disco al explorador. */
  onAddFolder: () => void;
}

/**
 * Explorador de repositorios.
 *
 * Queda de armazón: el ancho, el plegado y el foco del filtro, que son cosas
 * del hueco y no de lo que hay dentro. Los datos los lleva
 * `RepositoryController` y la vista es un componente que se suscribe a ellos.
 *
 * Lo plegado y lo buscado viven en el componente, no aquí ni en el controlador.
 * De ahí sale, por construcción, que desplegar una carpeta o escribir en el
 * filtro no vuelvan a consultar el backend: desde la vista no hay forma.
 */
export class RepositoryPanel {
  private readonly root: HTMLElement;
  private readonly options: RepositoryPanelOptions;
  private readonly controller: RepositoryController;
  private readonly vista: MountedComponent<RepositoryPanelProps>;
  private readonly desuscribir: () => void;

  private data: RepositoryData;
  private account: GithubAuthStatus | null = null;
  private activePath: string | null = null;
  private width = DEFAULT_WIDTH;

  constructor(root: HTMLElement, options: RepositoryPanelOptions) {
    this.root = root;
    this.options = options;
    this.controller = new RepositoryController(options);
    this.data = this.controller.snapshot();

    this.vista = mountComponent<RepositoryPanelProps>(this.root, RepositoryPanelView, this.props());
    this.desuscribir = this.controller.subscribe((data) => {
      this.data = data;
      this.render();
    });

    this.applyWidth(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH);
    this.wireResizer();

    // El estado de sesión tarda en llegar —sale a la red—, así que el pie
    // arranca pintado como «sin cuenta» en vez de con el hueco del avatar
    // vacío durante los primeros segundos.
    this.setAccount({ connected: false, user: null, expiresAt: null });
  }

  private props(): RepositoryPanelProps {
    return {
      data: this.data,
      account: this.account,
      activePath: this.activePath,
      onRefresh: () => void this.refresh(true),
      onAddFolder: () => this.options.onAddFolder(),
      onManage: () => this.options.onManage(),
      onOpen: (repository, document) => {
        this.options.onOpen(document.path, nameOf(document.relative));
        void touchRepository(repository.id);
      },
      onCreate: (repository) => this.options.onCreate(repository),
      onPublish: (repository) => this.options.onPublish(repository),
      onCloseFolder: (repository) => {
        void closeFolder(repository.id).then(() => this.refresh(true));
      },
    };
  }

  private render(): void {
    this.vista.update(this.props());
  }

  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle("is-collapsed", collapsed);
    if (collapsed) this.root.setAttribute("inert", "");
    else this.root.removeAttribute("inert");
  }

  setAccount(status: GithubAuthStatus): void {
    this.account = status;
    this.render();
  }

  /** Marca el documento que está en pantalla, si pertenece a un repositorio. */
  setActive(path: string | null): void {
    if (this.activePath === path) return;
    this.activePath = path;
    this.render();
  }

  focusFilter(): void {
    // Se busca al llamar y no se guarda: el campo lo pinta Preact, y quedarse
    // con el nodo de hace un rato es quedarse con uno que puede haber cambiado.
    const filtro = this.root.querySelector<HTMLInputElement>("#repos-filter");
    filtro?.focus();
    filtro?.select();
  }

  async refresh(forceDocuments = false): Promise<void> {
    await this.controller.refresh(forceDocuments);
  }

  async refreshPath(path: string | null): Promise<void> {
    await this.controller.refreshPath(path);
  }

  async refreshRepository(id: number, documentsChanged = false): Promise<void> {
    await this.controller.refreshRepository(id, documentsChanged);
  }

  repositoryOf(path: string | null): ConnectedRepository | null {
    return this.controller.repositoryOf(path);
  }

  owns(path: string | null): boolean {
    return this.controller.owns(path);
  }

  /** Libera observadores y respuestas pendientes al destruir la ventana. */
  dispose(): void {
    this.desuscribir();
    this.controller.dispose();
  }

  // --- Ancho -----------------------------------------------------------------

  private applyWidth(width: number): void {
    this.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
    const value = `${this.width}px`;
    this.root.style.setProperty("--repos-width", value);
    this.root.querySelector<HTMLElement>(".repos-inner")?.style.setProperty("--repos-width", value);
  }

  /**
   * El arrastre del borde, por delegación.
   *
   * El tirador lo pinta Preact, así que no se guarda una referencia a él: se
   * escucha en la raíz y se comprueba al vuelo de dónde salió el evento.
   */
  private wireResizer(): void {
    this.root.addEventListener("pointerdown", (event) => {
      const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>(".repos-resizer");
      if (!handle) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const origin = this.root.getBoundingClientRect().left;
      // Durante el arrastre la transición estorba: el panel iría por detrás del
      // ratón. Y el cursor debe ser el mismo sobre toda la ventana.
      this.root.classList.add("is-resizing");
      document.body.classList.add("is-resizing");

      const move = (moveEvent: PointerEvent): void => this.applyWidth(moveEvent.clientX - origin);
      const end = (): void => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        this.root.classList.remove("is-resizing");
        document.body.classList.remove("is-resizing");
        localStorage.setItem(WIDTH_KEY, String(this.width));
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });

    // Doble clic devuelve el ancho de fábrica.
    this.root.addEventListener("dblclick", (event) => {
      if (!(event.target as HTMLElement | null)?.closest(".repos-resizer")) return;
      this.applyWidth(DEFAULT_WIDTH);
      localStorage.setItem(WIDTH_KEY, String(this.width));
    });
  }
}
