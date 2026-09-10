import { icon } from "./icons.ts";
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

export interface UpdateBanner {
  comprobar: (force?: boolean) => void;
  /** Vuelve a enseñar la tarjeta apartada. */
  mostrar: () => void;
  pendiente: () => string | null;
}

type Estado = "idle" | "checking" | "available" | "installing" | "error";

/**
 * El aviso de versión nueva.
 *
 * Era una franja a todo lo ancho encima del editor: aparecía de golpe y
 * empujaba el documento hacia abajo mientras alguien escribía, que es la peor
 * manera de dar una noticia que no corre ninguna prisa. Ahora es una tarjeta en
 * una esquina, flotando sobre el texto y sin moverlo de sitio.
 *
 * Y «Más tarde» quiere decir más tarde. Ese botón guardaba la versión como
 * omitida para siempre —el rótulo decía una cosa y el código hacía otra—, de
 * modo que quien lo pulsaba esperando que se lo recordaran no volvía a saber de
 * esa versión nunca. Descartarla del todo es ahora una decisión aparte y dicha.
 */
export function mountUpdateBanner(host: HTMLElement, deps: UpdateDeps): UpdateBanner {
  let version = "";
  let notas = "";
  let motivo = "";
  let estado: Estado = "idle";

  host.className = "update-card";
  host.hidden = true;
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");

  /** Las novedades, en viñetas y sin pasar de tres: es un aviso, no el diario. */
  const puntos = (texto: string): string[] =>
    texto
      .split("\n")
      .map((linea) => linea.replace(/^[-*•]\s+/, "").trim())
      .filter((linea) => linea.length > 0 && !linea.startsWith("#"))
      .slice(0, 3);

  const pintar = (): void => {
    if (estado === "idle") {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.classList.toggle("is-error", estado === "error");

    if (estado === "checking") {
      host.innerHTML = `
        <div class="update-card-head">
          <span class="update-card-icon">${icon("refresh")}</span>
          <div class="update-card-title"><strong>Buscando actualizaciones…</strong></div>
          <button class="update-card-close" data-accion="cerrar" aria-label="Cerrar">${icon("close")}</button>
        </div>`;
      return;
    }

    if (estado === "installing") {
      host.innerHTML = `
        <div class="update-card-head">
          <span class="update-card-icon">${icon("download")}</span>
          <div class="update-card-title">
            <strong>Instalando Unfold ${version}</strong>
            <span class="update-card-progress-text">Preparando la descarga…</span>
          </div>
        </div>
        <div class="update-card-bar"><span></span></div>
        <p class="update-card-note">Unfold se reiniciará solo al terminar, y tus pestañas vuelven como están.</p>`;
      return;
    }

    if (estado === "error") {
      host.innerHTML = `
        <div class="update-card-head">
          <span class="update-card-icon">${icon("alert")}</span>
          <div class="update-card-title">
            <strong>No se pudo actualizar</strong>
            <span class="update-card-reason"></span>
          </div>
          <button class="update-card-close" data-accion="cerrar" aria-label="Cerrar">${icon("close")}</button>
        </div>
        <div class="update-card-actions">
          <button class="update-card-btn is-primary" data-accion="reintentar">Reintentar</button>
        </div>`;
      host.querySelector<HTMLElement>(".update-card-reason")!.textContent = motivo;
      return;
    }

    const lista = puntos(notas);
    host.innerHTML = `
      <div class="update-card-head">
        <span class="update-card-icon">${icon("download")}</span>
        <div class="update-card-title">
          <strong>Unfold ${version}</strong>
          <span>Hay una versión nueva disponible</span>
        </div>
        <button class="update-card-close" data-accion="tarde" aria-label="Más tarde">${icon("close")}</button>
      </div>
      ${lista.length ? `<ul class="update-card-notes">${lista.map(() => "<li></li>").join("")}</ul>` : ""}
      <div class="update-card-actions">
        <button class="update-card-btn is-primary" data-accion="instalar">Reiniciar e instalar</button>
        <button class="update-card-btn" data-accion="tarde">Más tarde</button>
      </div>
      <button class="update-card-skip" data-accion="omitir">Omitir esta versión</button>`;

    // El texto de las notas se pone por nodo y no interpolado: viene del
    // manifiesto, y ahí no se escribe nada dentro de una plantilla HTML.
    for (const [i, li] of [...host.querySelectorAll("li")].entries()) {
      li.textContent = lista[i]!;
    }
  };

  const manejadores = {
    onAvailable: (nueva: string, cuerpo: string) => {
      version = nueva;
      notas = cuerpo;
      estado = "available";
      deps.marcarPendiente(nueva);
      pintar();
    },
    onProgress: (descargado: number, total: number | null) => {
      const texto = host.querySelector<HTMLElement>(".update-card-progress-text");
      const barra = host.querySelector<HTMLElement>(".update-card-bar span");
      const megas = (descargado / 1024 / 1024).toFixed(1);
      if (texto) {
        texto.textContent = total
          ? `${megas} de ${(total / 1024 / 1024).toFixed(1)} MB`
          : `${megas} MB descargados`;
      }
      // Sin tamaño total no hay proporción honesta que dibujar, así que la barra
      // se queda indeterminada en vez de inventarse un porcentaje.
      if (barra && total) barra.style.width = `${Math.min(100, (descargado / total) * 100)}%`;
    },
    onError: (mensaje: string) => {
      console.error("Fallo al actualizar", mensaje);
      motivo = mensaje;
      estado = "error";
      pintar();
    },
  };

  const comprobar = (force = false): void => {
    estado = "checking";
    pintar();
    void buscarActualizacion(manejadores, force).then((encontrada) => {
      if (encontrada || estado !== "checking") return;
      estado = "idle";
      deps.marcarPendiente(null);
      pintar();
      deps.notify("Ya tienes la última versión de Unfold.");
    });
  };

  host.addEventListener("click", (event) => {
    const boton = (event.target as HTMLElement).closest<HTMLElement>("[data-accion]");
    if (!boton) return;

    switch (boton.dataset.accion) {
      case "cerrar":
        estado = "idle";
        pintar();
        break;
      // Se aparta, no se descarta: el punto en ajustes lo sigue diciendo.
      case "tarde":
        host.hidden = true;
        break;
      case "omitir":
        omitirVersion(version);
        estado = "idle";
        deps.marcarPendiente(null);
        pintar();
        deps.notify(`No se volverá a avisar de la versión ${version}.`);
        break;
      case "reintentar":
        comprobar(true);
        break;
      case "instalar":
        estado = "installing";
        pintar();
        void deps.guardarSesion().then(() => instalarActualizacion(manejadores));
        break;
    }
  });

  // Se consulta con retraso: la red no debe frenar el arranque del editor.
  window.setTimeout(() => void buscarActualizacion(manejadores), 4000);

  return {
    comprobar,
    mostrar: () => {
      if (estado === "available") pintar();
    },
    pendiente: () => (estado === "available" ? version : null),
  };
}
