/**
 * Aísla lo que hay detrás de un diálogo.
 *
 * Los diálogos se declaraban `aria-modal="true"` sin cumplirlo: con Tab se
 * salía al editor de detrás, y al cerrar el foco se quedaba donde cayera. Un
 * lector de pantalla se creía la promesa del atributo y leía el fondo igual.
 *
 * Se resuelve con `inert` sobre los hermanos, y no con una trampa de Tab a
 * mano, porque `inert` hace las dos cosas de una vez —quita del recorrido del
 * teclado y del árbol de accesibilidad— y no hay que enumerar qué elementos
 * son enfocables, que es donde esas trampas acaban fallando.
 *
 * Los diálogos se apilan: uno de confirmación puede abrirse encima de la vista
 * de cambios. Por eso se apunta a quién se marcó y se desmarca sólo a ésos: si
 * el de abajo ya estaba aislado, sigue estándolo al cerrarse el de arriba.
 */
export function aislarFondo(propio: HTMLElement): () => void {
  const previo = document.activeElement as HTMLElement | null;
  const marcados: HTMLElement[] = [];

  // Sin copiar: marcar `inert` no añade ni quita hijos, así que la colección
  // viva no se mueve bajo los pies.
  for (const nodo of document.body.children) {
    if (nodo === propio || !(nodo instanceof HTMLElement) || nodo.inert) continue;
    nodo.inert = true;
    marcados.push(nodo);
  }

  return () => {
    for (const nodo of marcados) nodo.inert = false;
    // Devolver el foco es la otra mitad: sin esto, cerrar con Escape deja el
    // recorrido del teclado empezando otra vez desde el principio de la página.
    previo?.focus?.();
  };
}
