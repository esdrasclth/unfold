/**
 * Aísla lo que hay detrás de un diálogo y devuelve el foco al cerrarlo.
 *
 * `inert` atrapa el recorrido del teclado y también oculta el fondo del árbol
 * de accesibilidad. Cada diálogo recuerda sólo los nodos que aisló, de modo
 * que una pila de overlays se libera en el orden correcto.
 */
export function aislarFondo(propio: HTMLElement): () => void {
  const previo = document.activeElement as HTMLElement | null;
  const marcados: HTMLElement[] = [];

  // DialogHost pone cada overlay en un hermano propio. La misma búsqueda
  // conserva compatibilidad con un diálogo montado directamente bajo `body`.
  const raiz = propio.closest<HTMLElement>(".dialog-host") ?? propio;
  const contenedor = raiz.parentElement ?? document.body;

  for (const nodo of contenedor.children) {
    if (nodo === raiz || !(nodo instanceof HTMLElement) || nodo.inert) continue;
    nodo.inert = true;
    marcados.push(nodo);
  }

  return () => {
    for (const nodo of marcados) nodo.inert = false;
    previo?.focus?.();
  };
}
