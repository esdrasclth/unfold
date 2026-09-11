import type { VNode } from "preact";

export interface HostedDialog {
  id: number;
  view: VNode<any>;
}

export interface DialogHostProps {
  dialogs: readonly HostedDialog[];
}

/**
 * Único lugar donde los overlays entran en el árbol de la aplicación.
 *
 * La fachada imperativa sólo cambia esta lista. Preact se encarga de montar,
 * actualizar y desmontar cada vista, incluida la limpieza de sus efectos.
 */
export function DialogHost({ dialogs }: DialogHostProps) {
  return (
    <>
      {dialogs.map((dialog) => (
        <div class="dialog-host" key={dialog.id}>
          {dialog.view}
        </div>
      ))}
    </>
  );
}
