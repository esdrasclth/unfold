import { useLayoutEffect, useRef } from "preact/hooks";

export interface TabItemProps {
  id: number;
  name: string;
  /** Se enseña como título: distingue dos documentos que se llaman igual. */
  path: string | null;
  dirty: boolean;
  active: boolean;
  onActivate: (id: number) => void;
  onClose: (id: number) => void;
  onKeyDown: (event: KeyboardEvent, id: number) => void;
}

/**
 * Una pestaña.
 *
 * Sigue siendo un `div` y no un `button` para que el aspa de cerrar pueda ser
 * un botón de verdad: un botón dentro de otro es HTML inválido. El teclado
 * llega igual, por `role="tab"` y la tabulación itinerante que lleva la barra.
 *
 * Mantenerse a la vista es cosa suya: la pestaña activa se desplaza sola
 * cuando le toca serlo, sin que la barra tenga que ir a buscarla al DOM.
 */
export function TabItem({
  id,
  name,
  path,
  dirty,
  active,
  onActivate,
  onClose,
  onKeyDown,
}: TabItemProps) {
  const propio = useRef<HTMLDivElement>(null);

  // En un efecto de disposición y no en uno normal: ocurre antes de que el
  // navegador pinte, así que no se llega a ver el salto.
  useLayoutEffect(() => {
    if (active) propio.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={propio}
      role="tab"
      id={`tab-${id}`}
      class={`tab${active ? " is-active" : ""}${dirty ? " is-dirty" : ""}`}
      title={path ?? name}
      aria-selected={active}
      // Sólo la activa entra en la tabulación y las flechas mueven dentro: es
      // lo que se espera de unas pestañas, y evita atrapar al tabulador.
      tabindex={active ? 0 : -1}
      onClick={() => onActivate(id)}
      onKeyDown={(event) => onKeyDown(event, id)}
      onAuxClick={(event) => {
        // El botón central cierra, como en cualquier navegador.
        if (event.button !== 1) return;
        event.preventDefault();
        onClose(id);
      }}
    >
      <span class="tab-name">{name}</span>
      <button
        type="button"
        class="tab-close"
        title="Cerrar (Ctrl+W)"
        aria-label={`Cerrar ${name}`}
        // Fuera de la tabulación: tropezar con un botón de cerrar entre pestaña
        // y pestaña es peor que tener que usar Supr o Ctrl+W.
        tabindex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onClose(id);
        }}
      >
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
          <path d="m3 3 6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}
