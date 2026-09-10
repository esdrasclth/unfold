import { h } from "preact";
import { openDialog, type DialogHandle } from "./dialogs.ts";
import { CommandPalette, type CommandAction } from "../components/dialogs/CommandPalette.tsx";

export type { CommandAction };

/**
 * La paleta abierta, si la hay.
 *
 * Se guarda el mando y no el nodo: quitar el elemento del DOM no desmontaría el
 * componente, y con él se quedarían sin soltar el aislamiento del fondo y el
 * foco de vuelta.
 */
let abierta: DialogHandle | null = null;

export function openCommandPalette(actions: readonly CommandAction[]): void {
  closeCommandPalette();

  let query = "";
  let activa = 0;

  const vista = () =>
    h(CommandPalette, {
      actions,
      query,
      activeIndex: activa,
      onQuery: (siguiente: string) => {
        query = siguiente;
        // La lista cambia bajo los pies: seguir en la fila cuarta de otra
        // lista distinta no significa nada.
        activa = 0;
        pintar();
      },
      onActive: (indice: number) => {
        activa = indice;
        pintar();
      },
      onRun: (action: CommandAction) => {
        closeCommandPalette();
        action.run();
      },
      onClose: closeCommandPalette,
    });

  const pintar = (): void => abierta?.update(vista());

  abierta = openDialog(vista());
}

export function closeCommandPalette(): void {
  abierta?.close();
  abierta = null;
}
