import {
  buscarActualizacion,
  instalarActualizacion,
  omitirVersion,
} from "../updates.ts";

/** Los elementos del aviso, que los busca quien monta la interfaz. */
export interface UpdateRefs {
  update: HTMLElement;
  updateText: HTMLElement;
  updateNow: HTMLButtonElement;
  updateLater: HTMLButtonElement;
}

export interface UpdateDeps {
  /** Para decir que no había nada, que el aviso no puede decirlo escondido. */
  notify: (message: string) => void;
  /**
   * Instalar reinicia la aplicación, así que la sesión tiene que estar en
   * disco antes de ceder el control, igual que al cerrar la ventana.
   */
  guardarSesion: () => Promise<void>;
}

export interface UpdateBanner {
  comprobar: (force?: boolean) => void;
}

/**
 * El aviso de versión nueva y lo que se puede hacer con él.
 *
 * Es una máquina de estados pequeña —buscando, disponible, instalando, error—
 * y el estado decide qué hace cada botón: el mismo «Actualizar» reintenta
 * cuando lo anterior falló. Vivía suelta en `main.ts` entre todo lo demás.
 */
export function mountUpdateBanner(el: UpdateRefs, deps: UpdateDeps): UpdateBanner {
  let versionNueva = "";
  let estado: "idle" | "available" | "checking" | "installing" | "error" = "idle";

  const manejadores = {
    onAvailable: (version: string, notas: string) => {
      estado = "available";
      el.update.classList.remove("is-error");
      versionNueva = version;
      const resumen = notas.split("\n")[0]?.trim();
      el.updateText.textContent = resumen
        ? `Versión ${version} disponible · ${resumen}`
        : `Versión ${version} disponible`;
      el.updateNow.textContent = "Actualizar";
      el.updateNow.hidden = false;
      el.updateLater.textContent = "Más tarde";
      el.updateLater.hidden = false;
      el.updateNow.disabled = false;
      el.update.hidden = false;
    },
    onProgress: (descargado: number, total: number | null) => {
      estado = "installing";
      el.update.classList.remove("is-error");
      const megas = (descargado / 1024 / 1024).toFixed(1);
      el.updateText.textContent = total
        ? `Descargando ${megas} de ${(total / 1024 / 1024).toFixed(1)} MB…`
        : `Descargando ${megas} MB…`;
    },
    onError: (mensaje: string) => {
      estado = "error";
      el.update.classList.add("is-error");
      console.error("Fallo al actualizar", mensaje);
      el.updateText.textContent = mensaje;
      el.updateNow.textContent = "Reintentar";
      el.updateNow.hidden = false;
      el.updateNow.disabled = false;
      el.updateLater.textContent = "Cerrar";
      el.updateLater.hidden = false;
      el.update.hidden = false;
    },
  };

  const comprobar = (force = false): void => {
    estado = "checking";
    el.update.classList.remove("is-error");
    el.updateText.textContent = "Buscando actualizaciones…";
    el.updateNow.hidden = true;
    el.updateLater.textContent = "Cancelar";
    el.updateLater.hidden = false;
    el.update.hidden = false;
    void buscarActualizacion(manejadores, force).then((found) => {
      if (!found && estado === "checking") {
        estado = "idle";
        el.update.hidden = true;
        deps.notify("No hay actualizaciones disponibles.");
      }
    });
  };

  el.updateNow.addEventListener("click", () => {
    if (estado === "error") {
      comprobar(true);
      return;
    }
    if (estado !== "available") return;
    estado = "installing";
    el.updateNow.disabled = true;
    el.updateLater.hidden = true;
    void deps.guardarSesion().then(() => instalarActualizacion(manejadores));
  });

  el.updateLater.addEventListener("click", () => {
    if (estado === "available" && versionNueva) omitirVersion(versionNueva);
    estado = "idle";
    el.update.hidden = true;
  });

  // Se consulta con retraso: la red no debe frenar el arranque del editor.
  window.setTimeout(() => void buscarActualizacion(manejadores), 4000);

  return { comprobar };
}
