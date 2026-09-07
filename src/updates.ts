import { isTauri } from "./files.ts";

/**
 * Aviso de versión nueva.
 *
 * La comprobación va contra un manifiesto firmado: Tauri verifica la firma con
 * la clave pública antes de instalar nada, de modo que quien pudiera suplantar
 * el servidor no puede colar otra cosa en su lugar.
 *
 * Se consulta unos segundos después de arrancar y no al abrir la ventana: la
 * red no debe retrasar que el editor esté listo para escribir.
 */

/** Una vez al día basta; comprobarlo en cada arranque sería ruido. */
const INTERVALO = 24 * 60 * 60 * 1000;
const CLAVE_ULTIMA = "unfold:ultima-comprobacion";
const CLAVE_OMITIDA = "unfold:version-omitida";

export interface UpdateHandlers {
  /** Muestra la barra con la versión y las novedades. */
  onAvailable: (version: string, notas: string) => void;
  onProgress: (descargado: number, total: number | null) => void;
  onError: (mensaje: string) => void;
}

type Actualizacion = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

let pendiente: Actualizacion = null;

function tocaComprobar(): boolean {
  const ultima = Number(localStorage.getItem(CLAVE_ULTIMA) ?? 0);
  return Date.now() - ultima > INTERVALO;
}

export async function buscarActualizacion(
  handlers: UpdateHandlers,
  forzar = false,
): Promise<void> {
  if (!isTauri) return;
  if (!forzar && !tocaComprobar()) return;

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const encontrada = await check();
    localStorage.setItem(CLAVE_ULTIMA, String(Date.now()));
    if (!encontrada) return;

    // Si ya se dijo "más tarde" para esta versión concreta, no se insiste.
    if (!forzar && localStorage.getItem(CLAVE_OMITIDA) === encontrada.version) return;

    pendiente = encontrada;
    handlers.onAvailable(encontrada.version, encontrada.body ?? "");
  } catch (error) {
    // Sin conexión o con el servidor caído no se molesta al usuario: esto es
    // una cortesía, no una función que le haya pedido.
    console.error("No se pudo comprobar si hay actualizaciones", error);
  }
}

/** Descarga, instala y reinicia. */
export async function instalarActualizacion(handlers: UpdateHandlers): Promise<void> {
  if (!pendiente) return;

  try {
    let descargado = 0;
    let total: number | null = null;

    await pendiente.downloadAndInstall((evento) => {
      if (evento.event === "Started") {
        total = evento.data.contentLength ?? null;
      } else if (evento.event === "Progress") {
        descargado += evento.data.chunkLength;
        handlers.onProgress(descargado, total);
      }
    });

    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (error) {
    handlers.onError(String(error));
  }
}

/** «Más tarde»: no se vuelve a avisar de esta versión. */
export function omitirVersion(version: string): void {
  localStorage.setItem(CLAVE_OMITIDA, version);
  pendiente = null;
}
