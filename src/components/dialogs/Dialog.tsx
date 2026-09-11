import { useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { aislarFondo } from "./FocusTrap.ts";
import { entrarEnLaPila, esElSuperior, salirDeLaPila } from "./stack.ts";

export interface DialogProps {
  /** `alertdialog` cuando interrumpe para preguntar algo que no puede esperar. */
  role?: "dialog" | "alertdialog";
  /** Nombre del diálogo para quien no ve el título. */
  label: string;
  /** Clase del fondo; cada diálogo trae la suya del CSS que ya existe. */
  backdropClass?: string;
  /** Clase del panel. */
  className?: string;
  /**
   * Cerrar. Si falta, el diálogo no se puede descartar: ni con Escape ni
   * pulsando fuera, que es lo que hace falta mientras algo está en marcha.
   */
  onClose?: () => void;
  /** Se enfoca al abrir; sin él, el primer enfocable del panel. */
  autoFocus?: string;
  /**
   * Responder que sí con Enter.
   *
   * Va en el panel y no en un elemento de dentro: el foco está atrapado aquí,
   * así que cualquier pulsación nace dentro y sube hasta él, esté donde esté.
   */
  onEnter?: () => void;
  children: ComponentChildren;
}

/**
 * Armazón de los diálogos.
 *
 * Reúne lo que todos repetían: el fondo que cierra al pulsarlo, Escape, el
 * aislamiento de lo que hay detrás y devolver el foco al cerrar.
 *
 * Los oyentes y el aislamiento se montan y se sueltan en el mismo efecto, así
 * que no pueden quedarse sueltos: si el diálogo desaparece, desaparecen con él.
 * Antes eso dependía de que cada `close()` se acordara de deshacer lo suyo.
 */
export function Dialog({
  role = "dialog",
  label,
  backdropClass = "dialog-backdrop",
  className = "dialog",
  onClose,
  autoFocus,
  onEnter,
  children,
}: DialogProps) {
  const fondo = useRef<HTMLDivElement>(null);
  // En una ref y no en el cuerpo: el efecto se monta una sola vez, y sin esto
  // se quedaría con el `onClose` que hubiera en el primer pintado.
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useLayoutEffect(() => {
    const propio = fondo.current;
    if (!propio) return;

    const id = entrarEnLaPila();
    const soltarFoco = aislarFondo(propio);

    const alTeclado = (event: KeyboardEvent): void => {
      // Sólo el de arriba atiende: con una confirmación encima, Escape es suyo.
      if (event.key !== "Escape" || !esElSuperior(id) || !cerrar.current) return;
      event.preventDefault();
      event.stopPropagation();
      cerrar.current();
    };
    document.addEventListener("keydown", alTeclado, true);

    const inicial = autoFocus
      ? propio.querySelector<HTMLElement>(autoFocus)
      : propio.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]");
    inicial?.focus();

    return () => {
      document.removeEventListener("keydown", alTeclado, true);
      salirDeLaPila(id);
      soltarFoco();
    };
    // Se monta una vez por diálogo: lo de dentro cambia, el armazón no.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      class={backdropClass}
      ref={fondo}
      onMouseDown={(event) => {
        // Sólo el fondo desnudo: pulsar dentro del panel no cierra nada.
        if (event.target === fondo.current) cerrar.current?.();
      }}
    >
      <div
        class={className}
        role={role}
        aria-modal="true"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !onEnter) return;
          // No dentro de un campo de varias líneas: ahí Enter escribe.
          if ((event.target as HTMLElement).tagName === "TEXTAREA") return;
          event.preventDefault();
          event.stopPropagation();
          onEnter();
        }}
      >
        {children}
      </div>
    </div>
  );
}
