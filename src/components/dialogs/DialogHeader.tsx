import type { ComponentChildren } from "preact";
import { icon } from "../../ui/icons.ts";

export interface DialogHeaderProps {
  title: string;
  /** Clase de la cabecera; cada diálogo trae la del CSS que ya existe. */
  className?: string;
  titleClass?: string;
  closeClass?: string;
  onClose?: () => void;
  children?: ComponentChildren;
}

/**
 * Cabecera de un diálogo.
 *
 * El título va como texto y nunca interpolado: lleva nombres de archivo y de
 * repositorio, que vienen del disco y de GitHub.
 */
export function DialogHeader({
  title,
  className = "dialog-head",
  titleClass = "dialog-title",
  closeClass = "dialog-close",
  onClose,
  children,
}: DialogHeaderProps) {
  return (
    <header class={className}>
      <h2 class={titleClass}>{title}</h2>
      {children}
      {onClose && (
        <button
          type="button"
          class={closeClass}
          title="Cerrar (Esc)"
          aria-label="Cerrar"
          onClick={onClose}
          dangerouslySetInnerHTML={{ __html: icon("close") }}
        />
      )}
    </header>
  );
}
