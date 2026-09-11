import type { VNode } from "preact";
import type { HostedDialog } from "../components/dialogs/DialogHost.tsx";

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

let siguienteId = 1;
let dialogs: readonly HostedDialog[] = [];
const subscriptions = new Set<(dialogs: readonly HostedDialog[]) => void>();

export function dialogSnapshot(): readonly HostedDialog[] {
  return dialogs;
}

export function subscribeDialogs(
  subscription: (dialogs: readonly HostedDialog[]) => void,
): () => void {
  subscriptions.add(subscription);
  return () => subscriptions.delete(subscription);
}

function publish(next: readonly HostedDialog[]): void {
  dialogs = next;
  for (const subscription of subscriptions) subscription(dialogs);
}

export function openDialog(vista: Vista, alCerrar?: () => void): DialogHandle {
  const id = siguienteId++;
  publish([...dialogs, { id, view: vista }]);

  let cerrado = false;
  return {
    update: (siguiente) => {
      if (cerrado) return;
      publish(dialogs.map((dialog) => dialog.id === id ? { ...dialog, view: siguiente } : dialog));
    },
    close: () => {
      if (cerrado) return;
      cerrado = true;
      publish(dialogs.filter((dialog) => dialog.id !== id));
      alCerrar?.();
    },
  };
}
