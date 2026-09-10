import { h } from "preact";
import { invoke } from "@tauri-apps/api/core";
import { openDialog, type DialogHandle } from "./dialogs.ts";
import { SearchDocuments, type Hit } from "../components/dialogs/SearchDocuments.tsx";
import { isTauri } from "../files.ts";

export type { Hit };

interface SearchReport {
  hits: Hit[];
  truncated: boolean;
}

/** Se espera a que la mano pare: cada pulsación lee archivos del disco. */
const ESPERA = 180;
/**
 * Con una sola letra encuentra el disco entero: no es una búsqueda, es esperar.
 * Se dice, en vez de enseñar una lista inútil.
 */
const MINIMO = 2;

/**
 * Cómo cerrar la búsqueda que esté abierta.
 *
 * Se guarda el cierre y no el diálogo: abrir una búsqueda nueva tiene que
 * cancelar el temporizador y la generación de la anterior, y eso vive en su
 * cierre. Sin esto, una consulta en vuelo volvía y pintaba sus resultados
 * dentro del diálogo recién abierto.
 */
let cerrarActual: (() => void) | null = null;

/**
 * Buscar en todos los documentos del explorador.
 *
 * La vista es un componente; aquí quedan la consulta, el retardo y el contador
 * que descarta respuestas viejas. El temporizador se cancela al cerrar, en el
 * mismo sitio donde se desmonta: si no, una búsqueda en vuelo volvería para
 * pintar sobre un diálogo que ya no existe.
 */
export function openDocumentSearch(abrir: (path: string, line: number) => void): void {
  cerrarActual?.();

  let abierto: DialogHandle | null = null;

  let query = "";
  let hits: Hit[] = [];
  let truncated = false;
  let activa = 0;
  let aviso: string | null = isTauri
    ? "Escribe para buscar en los documentos."
    : "Buscar en todos los documentos requiere la aplicación de escritorio.";
  /** Cada búsqueda anula el pintado de la anterior: se teclea más rápido que el disco. */
  let generacion = 0;
  let temporizador: number | undefined;

  const vista = () =>
    h(SearchDocuments, {
      query,
      hits,
      truncated,
      notice: aviso,
      activeIndex: activa,
      onQuery: (siguiente: string) => {
        query = siguiente;
        window.clearTimeout(temporizador);
        temporizador = window.setTimeout(() => void buscar(), ESPERA);
        pintar();
      },
      onActive: (indice: number) => {
        activa = indice;
        pintar();
      },
      onOpen: (hit: Hit) => {
        cerrar();
        abrir(hit.path, hit.line);
      },
      onClose: cerrar,
    });

  const pintar = (): void => abierto?.update(vista());

  const buscar = async (): Promise<void> => {
    const consulta = query.trim();
    const mia = ++generacion;
    if (consulta.length < MINIMO) {
      hits = [];
      truncated = false;
      aviso = consulta ? "Escribe al menos dos letras." : "Escribe para buscar en los documentos.";
      pintar();
      return;
    }
    try {
      const informe = await invoke<SearchReport>("search_documents", { query: consulta });
      // Una respuesta que llega tarde no puede pisar a una más reciente.
      if (mia !== generacion || !abierto) return;
      hits = informe.hits;
      truncated = informe.truncated;
      activa = 0;
      aviso = hits.length === 0 ? `Ninguna línea contiene «${consulta}».` : null;
      pintar();
    } catch (error) {
      if (mia !== generacion || !abierto) return;
      hits = [];
      aviso = typeof error === "string" ? error : "No se pudo buscar";
      pintar();
    }
  };

  function cerrar(): void {
    // El temporizador se cancela aquí y no en un efecto del componente: es de
    // esta búsqueda, no de lo que se esté enseñando.
    window.clearTimeout(temporizador);
    generacion += 1;
    if (cerrarActual === cerrar) cerrarActual = null;
    abierto?.close();
    abierto = null;
  }

  cerrarActual = cerrar;
  abierto = openDialog(vista());
}
