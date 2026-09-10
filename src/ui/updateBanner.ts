import { mountComponent } from "../components/mountComponent.ts";
import {
  UpdateBanner,
  type UpdateAction,
  type UpdateBannerProps,
  type UpdateStatus,
} from "../components/updates/UpdateBanner.tsx";
import { buscarActualizacion, instalarActualizacion, omitirVersion } from "../updates.ts";

export interface UpdateDeps {
  /** Para decir que no había nada, que la tarjeta no puede decirlo escondida. */
  notify: (message: string) => void;
  /**
   * Instalar reinicia la aplicación, así que la sesión tiene que estar en disco
   * antes de ceder el control, igual que al cerrar la ventana.
   */
  guardarSesion: () => Promise<void>;
  /**
   * Enciende o apaga la señal de que hay algo pendiente.
   *
   * Es lo que impide que apartar la tarjeta pierda el aviso: quien la cierra
   * sigue viendo un punto en el botón de ajustes, y ahí vuelve a encontrarlo.
   */
  marcarPendiente: (version: string | null) => void;
}

export interface UpdateBannerHandle {
  comprobar: (force?: boolean) => void;
  /** Vuelve a enseñar la tarjeta apartada. */
  mostrar: () => void;
  pendiente: () => string | null;
}

/**
 * El controlador del aviso de versión nueva.
 *
 * La tarjeta es un componente Preact que sólo pinta; aquí viven el estado, los
 * temporizadores y las llamadas a la red. Es la misma separación que pide el
 * panel de repositorios: el componente se suscribe a resultados y no los va a
 * buscar él.
 *
 * Apartar la tarjeta no es lo mismo que descartar la versión, y el aviso no
 * puede perderse al cerrarlo: mientras quede algo pendiente el botón de ajustes
 * lo señala, y desde ahí se recupera.
 */
export function mountUpdateBanner(host: HTMLElement, deps: UpdateDeps): UpdateBannerHandle {
  host.className = "update-card";
  host.hidden = true;
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");

  let vista: UpdateBannerProps = {
    status: "idle",
    version: "",
    notes: "",
    reason: "",
    downloaded: 0,
    total: null,
    onAction: (accion) => atender(accion),
  };

  const tarjeta = mountComponent<UpdateBannerProps>(host, UpdateBanner, vista);

  const pintar = (cambio: Partial<UpdateBannerProps> = {}): void => {
    vista = { ...vista, ...cambio };
    // El hueco se esconde entero: sin esto quedaría una caja vacía con su borde
    // y su sombra flotando en la esquina.
    host.hidden = vista.status === "idle";
    host.classList.toggle("is-error", vista.status === "error");
    tarjeta.update(vista);
  };

  const manejadores = {
    onAvailable: (version: string, notes: string) => {
      deps.marcarPendiente(version);
      pintar({ status: "available", version, notes });
    },
    onProgress: (downloaded: number, total: number | null) => pintar({ downloaded, total }),
    onError: (reason: string) => {
      console.error("Fallo al actualizar", reason);
      pintar({ status: "error", reason });
    },
  };

  const comprobar = (force = false): void => {
    pintar({ status: "checking" });
    void buscarActualizacion(manejadores, force).then((encontrada) => {
      if (encontrada || vista.status !== "checking") return;
      deps.marcarPendiente(null);
      pintar({ status: "idle" });
      deps.notify("Ya tienes la última versión de Unfold.");
    });
  };

  function atender(accion: UpdateAction): void {
    switch (accion) {
      case "cerrar":
        pintar({ status: "idle" });
        break;
      // Se aparta, no se descarta: el punto en ajustes lo sigue diciendo.
      case "tarde":
        host.hidden = true;
        break;
      case "omitir": {
        const descartada = vista.version;
        omitirVersion(descartada);
        deps.marcarPendiente(null);
        pintar({ status: "idle" });
        deps.notify(`No se volverá a avisar de la versión ${descartada}.`);
        break;
      }
      case "reintentar":
        comprobar(true);
        break;
      case "instalar":
        pintar({ status: "installing", downloaded: 0, total: null });
        void deps.guardarSesion().then(() => instalarActualizacion(manejadores));
        break;
    }
  }

  // Se consulta con retraso: la red no debe frenar el arranque del editor.
  window.setTimeout(() => void buscarActualizacion(manejadores), 4000);

  return {
    comprobar,
    mostrar: () => {
      if (vista.status === "available") host.hidden = false;
    },
    pendiente: () => (vista.status === "available" ? vista.version : null),
  };
}

export type { UpdateStatus };
