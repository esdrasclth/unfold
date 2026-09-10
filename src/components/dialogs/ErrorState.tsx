import type { ComponentChildren } from "preact";

export interface ErrorStateProps {
  message: string;
  children?: ComponentChildren;
}

/**
 * Lo que falló, dicho.
 *
 * `role="alert"` porque un fallo que aparece en una esquina mientras se mira
 * otra cosa es un fallo que no se ha contado. El mensaje va como texto: viene
 * del servidor de GitHub y de libgit2.
 */
export function ErrorState({ message, children }: ErrorStateProps) {
  return (
    <p class="github-error" role="alert">
      {message}
      {children}
    </p>
  );
}
