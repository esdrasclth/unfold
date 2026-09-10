import { h } from "preact";
import type { ConnectedRepository } from "../repositories.ts";
import { openDialog, type DialogHandle } from "./dialogs.ts";
import {
  CommitDialogController,
  type CommitDialogOptions,
} from "../github/CommitDialogController.ts";
import { CommitDialog } from "../components/dialogs/github/CommitDialog.tsx";

export type { CommitDialogOptions };

let cerrarActual: (() => void) | null = null;

/**
 * Vista de cambios y publicación.
 *
 * Se guarda el cierre y no el nodo: mientras se publica hay un oyente de avance
 * enganchado a Rust, y quitar el elemento no lo soltaría.
 */
export function openCommitDialog(
  repository: ConnectedRepository,
  options: CommitDialogOptions = {},
): void {
  cerrarActual?.();

  let dialogo: DialogHandle | null = null;
  const controller = new CommitDialogController(repository, { ...options, onClose: cerrar });

  const vista = () =>
    h(CommitDialog, { repository, data: controller.snapshot(), controller, onClose: cerrar });

  const desuscribir = controller.subscribe(() => dialogo?.update(vista()));

  function cerrar(): void {
    // Con algo en marcha no se cierra: publicar a medias no se puede deshacer.
    if (controller.busy) return;
    desuscribir();
    controller.dispose();
    if (cerrarActual === cerrar) cerrarActual = null;
    dialogo?.close();
    dialogo = null;
  }

  cerrarActual = cerrar;
  dialogo = openDialog(vista());
  void controller.load();
}
