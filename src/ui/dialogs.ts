import { render, type VNode } from "preact";

/** Cualquier vista: los diálogos traen sus propias propiedades. */
type Vista = VNode<any>;

/**
 * Dónde viven los diálogos abiertos.
 *
 * Cada uno recibe su propio hueco colgando del `body`, y no todos dentro de uno
 * común, porque el aislamiento del fondo funciona marcando `inert` a los
 * hermanos del diálogo. Metidos en el mismo contenedor, una confirmación no
 * podría aislar la vista de cambios sobre la que se abre: serían hermanos entre
 * sí pero el contenedor sería un único hermano para todo lo demás.
 *
 * Preact es dueño único del hueco mientras dure, y al cerrar se desmonta antes
 * de quitarlo, para que los efectos suelten lo suyo: los oyentes de teclado, el
 * aislamiento y el foco de vuelta.
 */
export interface DialogHandle {
  /** Vuelve a pintar el diálogo con contenido nuevo. */
  update: (vista: Vista) => void;
  close: () => void;
}

export function openDialog(vista: Vista, alCerrar?: () => void): DialogHandle {
  const hueco = document.createElement("div");
  hueco.className = "dialog-host";
  document.body.append(hueco);
  render(vista, hueco);

  let cerrado = false;
  return {
    update: (siguiente) => {
      if (!cerrado) render(siguiente, hueco);
    },
    close: () => {
      if (cerrado) return;
      cerrado = true;
      // Desmontar antes de quitar: es lo que dispara la limpieza de los efectos.
      render(null, hueco);
      hueco.remove();
      alCerrar?.();
    },
  };
}
