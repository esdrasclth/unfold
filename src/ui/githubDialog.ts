import { h } from "preact";
import { openDialog, type DialogHandle } from "./dialogs.ts";
import {
  GithubDialogController,
  type GithubDialogOptions,
} from "../github/GithubDialogController.ts";
import { GithubDialog } from "../components/dialogs/github/GithubDialog.tsx";

export type { GithubDialogOptions };

/**
 * El diálogo abierto, si lo hay.
 *
 * Se guarda el cierre y no el nodo: quitar el elemento no pararía el sondeo del
 * flujo de dispositivo, que seguiría pidiendo a GitHub cada pocos segundos
 * hasta que caducara el código.
 */
let cerrarActual: (() => void) | null = null;

export function openGithubDialog(options: GithubDialogOptions = {}): void {
  cerrarActual?.();

  let dialogo: DialogHandle | null = null;
  const controller = new GithubDialogController({ ...options, onClose: cerrar });

  const pintar = (): void => {
    dialogo?.update(
      h(GithubDialog, { data: controller.snapshot(), controller, onClose: cerrar }),
    );
  };

  const desuscribir = controller.subscribe(pintar);

  function cerrar(): void {
    desuscribir();
    controller.dispose();
    if (cerrarActual === cerrar) cerrarActual = null;
    dialogo?.close();
    dialogo = null;
  }

  cerrarActual = cerrar;
  dialogo = openDialog(
    h(GithubDialog, { data: controller.snapshot(), controller, onClose: cerrar }),
  );
  controller.start();
}
