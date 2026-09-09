import { invoke } from "@tauri-apps/api/core";
import { icon } from "./icons.ts";
import { aislarFondo } from "./modalFocus.ts";
import { isTauri } from "../files.ts";

export interface Hit {
  rootId: number;
  rootName: string;
  path: string;
  relative: string;
  line: number;
  text: string;
  from: number;
  to: number;
}

interface SearchReport {
  hits: Hit[];
  truncated: boolean;
}

let cerrarActual: (() => void) | null = null;

/**
 * Buscar en todos los documentos del explorador.
 *
 * `Ctrl+F` busca dentro del documento abierto; esto es lo otro, que es lo que
 * hace falta con un árbol de cuarenta archivos delante: en cuál de todos está
 * esa frase. Agrupa por archivo porque lo que se decide primero es a qué
 * documento ir, no a qué línea.
 */
export function openDocumentSearch(abrir: (path: string, line: number) => void): void {
  cerrarActual?.();

  const backdrop = document.createElement("div");
  backdrop.className = "command-palette-backdrop buscador-backdrop";
  backdrop.innerHTML = `
    <div class="command-palette buscador" role="dialog" aria-label="Buscar en los documentos">
      <div class="command-palette-search">
        ${icon("search")}
        <input class="command-palette-input" placeholder="Buscar en todos los documentos…"
               aria-label="Buscar en todos los documentos" autocomplete="off" />
      </div>
      <div class="command-palette-list buscador-resultados" role="listbox"></div>
      <div class="command-palette-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> moverse</span>
        <span><kbd>↵</kbd> abrir</span>
        <span><kbd>Esc</kbd> cerrar</span>
        <span class="buscador-cuenta"></span>
      </div>
    </div>
  `;

  const input = backdrop.querySelector<HTMLInputElement>(".command-palette-input")!;
  const lista = backdrop.querySelector<HTMLElement>(".buscador-resultados")!;
  const cuenta = backdrop.querySelector<HTMLElement>(".buscador-cuenta")!;

  let filas: Hit[] = [];
  let activa = 0;
  /** Cada búsqueda anula el pintado de la anterior: se teclea más rápido que el disco. */
  let generacion = 0;
  let temporizador: number | undefined;

  let soltarFoco: (() => void) | null = null;
  const cerrar = (): void => {
    window.clearTimeout(temporizador);
    soltarFoco?.();
    soltarFoco = null;
    backdrop.remove();
    if (cerrarActual === cerrar) cerrarActual = null;
  };
  cerrarActual = cerrar;

  const pintarActiva = (): void => {
    const botones = lista.querySelectorAll<HTMLElement>(".buscador-hit");
    for (const [indice, boton] of botones.entries()) {
      const on = indice === activa;
      boton.classList.toggle("is-active", on);
      boton.setAttribute("aria-selected", String(on));
      if (on) boton.scrollIntoView({ block: "nearest" });
    }
  };

  const abrirActiva = (): void => {
    const hit = filas[activa];
    if (!hit) return;
    cerrar();
    abrir(hit.path, hit.line);
  };

  const aviso = (texto: string): void => {
    const p = document.createElement("p");
    p.className = "command-palette-empty";
    p.textContent = texto;
    lista.replaceChildren(p);
  };

  const pintar = (informe: SearchReport, consulta: string): void => {
    filas = informe.hits;
    activa = 0;
    cuenta.textContent = informe.truncated
      ? `${filas.length}+ resultados`
      : filas.length === 1
        ? "1 resultado"
        : `${filas.length} resultados`;

    if (filas.length === 0) {
      aviso(`Ninguna línea contiene «${consulta}».`);
      return;
    }

    lista.replaceChildren();
    let archivoAnterior = "";
    for (const [indice, hit] of filas.entries()) {
      const clave = `${hit.rootId}:${hit.relative}`;
      if (clave !== archivoAnterior) {
        archivoAnterior = clave;
        const cabecera = document.createElement("p");
        cabecera.className = "buscador-archivo";
        cabecera.innerHTML = `<strong></strong><span></span>`;
        cabecera.querySelector("strong")!.textContent = hit.relative;
        cabecera.querySelector("span")!.textContent = hit.rootName;
        lista.append(cabecera);
      }

      const fila = document.createElement("button");
      fila.className = "buscador-hit";
      fila.type = "button";
      fila.setAttribute("role", "option");

      const numero = document.createElement("span");
      numero.className = "buscador-linea";
      numero.textContent = String(hit.line);

      const texto = document.createElement("span");
      texto.className = "buscador-texto";
      // Se resalta el trozo que coincide: es lo que explica por qué esa línea
      // está en la lista, igual que en la paleta de comandos.
      const marca = document.createElement("mark");
      marca.textContent = hit.text.slice(hit.from, hit.to);
      texto.append(hit.text.slice(0, hit.from), marca, hit.text.slice(hit.to));

      fila.append(numero, texto);
      fila.addEventListener("click", () => {
        activa = indice;
        abrirActiva();
      });
      fila.addEventListener("mousemove", () => {
        if (activa === indice) return;
        activa = indice;
        pintarActiva();
      });
      lista.append(fila);
    }
    pintarActiva();
  };

  const buscar = async (): Promise<void> => {
    const consulta = input.value.trim();
    const mia = ++generacion;
    if (consulta.length < 2) {
      // Con una sola letra encuentra el disco entero: no es una búsqueda, es
      // esperar. Se dice, en vez de enseñar una lista inútil.
      filas = [];
      cuenta.textContent = "";
      aviso(consulta ? "Escribe al menos dos letras." : "Escribe para buscar en los documentos.");
      return;
    }
    try {
      const informe = await invoke<SearchReport>("search_documents", { query: consulta });
      // Una respuesta que llega tarde no puede pisar a una más reciente.
      if (mia !== generacion) return;
      pintar(informe, consulta);
    } catch (error) {
      if (mia !== generacion) return;
      aviso(typeof error === "string" ? error : "No se pudo buscar");
    }
  };

  input.addEventListener("input", () => {
    window.clearTimeout(temporizador);
    // Se espera a que la mano pare: cada pulsación lee archivos del disco.
    temporizador = window.setTimeout(() => void buscar(), 180);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cerrar();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (filas.length === 0) return;
      const paso = event.key === "ArrowDown" ? 1 : -1;
      activa = (activa + paso + filas.length) % filas.length;
      pintarActiva();
    } else if (event.key === "Enter") {
      event.preventDefault();
      abrirActiva();
    }
  });

  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) cerrar();
  });

  document.body.append(backdrop);
  soltarFoco = aislarFondo(backdrop);
  aviso(
    isTauri
      ? "Escribe para buscar en los documentos."
      : "Buscar en todos los documentos requiere la aplicación de escritorio.",
  );
  input.focus();
}
