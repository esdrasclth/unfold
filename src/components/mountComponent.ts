import { render, type ComponentType, type VNode } from "preact";
import { h } from "preact";

/**
 * Un componente Preact montado dentro de un hueco vacío, con mando imperativo.
 *
 * La migración es progresiva: `main.ts` sigue siendo quien sabe cuándo cambia
 * algo, así que necesita poder decir «vuelve a pintarte con esto». Devolver un
 * mando con `update` y `unmount` deja que las llamadas existentes —que hasta
 * ahora eran `tabBar.render(...)`— sigan pareciéndose a lo que eran.
 *
 * La regla que no se rompe: dentro del hueco manda Preact y sólo Preact. Nadie
 * mete `innerHTML` ni `appendChild` ahí, porque el reconciliador da por hecho
 * que los nodos que ve son los que él puso.
 */
export interface MountedComponent<P> {
  update: (props: P) => void;
  unmount: () => void;
}

export function mountComponent<P extends Record<string, unknown>>(
  host: HTMLElement,
  Component: ComponentType<P>,
  props: P,
): MountedComponent<P> {
  // El hueco tiene que llegar vacío: si trae restos del marcado imperativo,
  // Preact intentaría reutilizarlos como si fueran suyos.
  host.textContent = "";

  const pintar = (siguientes: P): void => {
    render(h(Component as ComponentType<Record<string, unknown>>, siguientes) as VNode, host);
  };

  pintar(props);

  return {
    update: pintar,
    unmount: () => render(null, host),
  };
}
