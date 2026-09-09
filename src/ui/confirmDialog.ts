import { aislarFondo } from "./modalFocus.ts";

export interface DialogChoice {
  label: string;
  /** El primario se destaca y responde al Enter. */
  primary?: boolean;
  /** El de cancelar responde al Escape y al clic en el fondo. */
  cancel?: boolean;
  value: string;
}

/**
 * Diálogo modal propio.
 *
 * No se usa el del sistema porque hacen falta tres salidas —guardar,
 * descartar y cancelar— y los diálogos de Tauri sólo ofrecen dos botones.
 * Además así respeta el tema y el color de barra elegidos.
 */
export function confirmDialog(
  title: string,
  message: string,
  choices: DialogChoice[],
): Promise<string> {
  return new Promise((resolve) => {
    let soltarFoco: (() => void) | null = null;
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 class="dialog-title" id="dialog-title"></h2>
        <p class="dialog-message"></p>
        <div class="dialog-actions"></div>
      </div>
    `;
    // textContent y no innerHTML: el mensaje lleva el nombre del archivo.
    backdrop.querySelector<HTMLElement>(".dialog-title")!.textContent = title;
    backdrop.querySelector<HTMLElement>(".dialog-message")!.textContent = message;

    const actions = backdrop.querySelector<HTMLElement>(".dialog-actions")!;
    const cancelValue = choices.find((choice) => choice.cancel)?.value;

    const close = (value: string): void => {
      document.removeEventListener("keydown", onKey, true);
      soltarFoco?.();
      soltarFoco = null;
      backdrop.remove();
      resolve(value);
    };

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape" && cancelValue !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        close(cancelValue);
      } else if (event.key === "Enter") {
        const primary = choices.find((choice) => choice.primary);
        if (primary) {
          event.preventDefault();
          event.stopPropagation();
          close(primary.value);
        }
      }
    }

    for (const choice of choices) {
      const button = document.createElement("button");
      button.className = `dialog-button${choice.primary ? " is-primary" : ""}`;
      button.textContent = choice.label;
      button.addEventListener("click", () => close(choice.value));
      actions.appendChild(button);
    }

    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop && cancelValue !== undefined) close(cancelValue);
    });

    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    soltarFoco = aislarFondo(backdrop);
    actions.querySelector<HTMLButtonElement>(".is-primary")?.focus();
  });
}
