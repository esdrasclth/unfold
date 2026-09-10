/**
 * Qué diálogo está encima.
 *
 * Los diálogos se apilan: una confirmación puede abrirse sobre la vista de
 * cambios, y ésta sobre el diálogo de GitHub. Escape tiene que cerrar el de
 * arriba y sólo ése.
 *
 * Antes cada uno resolvía eso por su cuenta y mal: el de GitHub comprobaba si
 * existía un `.dialog-backdrop` en la página para apartarse, o sea que
 * codificaba la clase CSS de otro diálogo distinto. Funcionaba mientras nadie
 * añadiera un tercero.
 *
 * Aquí es una pila y ya está. Quien se monta se apunta, quien se va se borra, y
 * sólo el último atiende al teclado. No hace falta que ninguno sepa de los
 * demás.
 */
let siguiente = 1;
const abiertos: number[] = [];

export function entrarEnLaPila(): number {
  const id = siguiente++;
  abiertos.push(id);
  return id;
}

export function salirDeLaPila(id: number): void {
  const indice = abiertos.indexOf(id);
  if (indice >= 0) abiertos.splice(indice, 1);
}

export function esElSuperior(id: number): boolean {
  return abiertos.at(-1) === id;
}

/** Sólo para las pruebas: deja la pila como recién arrancada. */
export function vaciarLaPila(): void {
  abiertos.length = 0;
}
