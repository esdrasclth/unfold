import { Dialog } from "./Dialog.tsx";
import { DialogActions, type DialogChoice } from "./DialogActions.tsx";

export interface ConfirmDialogProps {
  title: string;
  message: string;
  choices: readonly DialogChoice[];
  onChoose: (value: string) => void;
}

/**
 * Diálogo de confirmación.
 *
 * No se usa el del sistema porque hacen falta tres salidas —guardar, descartar
 * y cancelar— y los de Tauri sólo ofrecen dos botones. Además así respeta el
 * tema y el color de barra elegidos.
 *
 * El título y el mensaje son texto y nunca se interpolan: llevan el nombre del
 * archivo, que viene del disco.
 */
export function ConfirmDialog({ title, message, choices, onChoose }: ConfirmDialogProps) {
  const cancelar = choices.find((choice) => choice.cancel)?.value;
  const primario = choices.find((choice) => choice.primary);

  return (
    <Dialog
      role="alertdialog"
      label={title}
      // Sin salida de cancelar no hay forma de descartarlo: la pregunta tiene
      // que responderse con uno de los botones.
      onClose={cancelar === undefined ? undefined : () => onChoose(cancelar)}
      autoFocus=".is-primary"
      onEnter={primario ? () => onChoose(primario.value) : undefined}
    >
      <h2 class="dialog-title">{title}</h2>
      <p class="dialog-message">{message}</p>
      <DialogActions choices={choices} onChoose={onChoose} />
    </Dialog>
  );
}
