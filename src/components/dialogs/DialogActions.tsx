export interface DialogChoice {
  label: string;
  /** El primario se destaca y responde al Enter. */
  primary?: boolean;
  /** El de cancelar responde al Escape y al clic en el fondo. */
  cancel?: boolean;
  value: string;
}

export interface DialogActionsProps {
  choices: readonly DialogChoice[];
  className?: string;
  buttonClass?: string;
  onChoose: (value: string) => void;
}

export function DialogActions({
  choices,
  className = "dialog-actions",
  buttonClass = "dialog-button",
  onChoose,
}: DialogActionsProps) {
  return (
    <div class={className}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          class={`${buttonClass}${choice.primary ? " is-primary" : ""}`}
          onClick={() => onChoose(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
