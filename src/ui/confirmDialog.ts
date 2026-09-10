import { openDialog } from "./dialogs.ts";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog.tsx";
import type { DialogChoice } from "../components/dialogs/DialogActions.tsx";
import { h } from "preact";

export type { DialogChoice };

/**
 * Preguntar y esperar la respuesta.
 *
 * La vista es un componente, pero quien llama sigue viendo una promesa: es lo
 * que permite escribir `await confirmDialog(...)` en medio de cerrar una
 * pestaña, sin repartir esa decisión en devoluciones de llamada.
 */
export function confirmDialog(
  title: string,
  message: string,
  choices: DialogChoice[],
): Promise<string> {
  return new Promise((resolve) => {
    const handle = openDialog(
      h(ConfirmDialog, {
        title,
        message,
        choices,
        onChoose: (value: string) => {
          handle.close();
          resolve(value);
        },
      }),
    );
  });
}
