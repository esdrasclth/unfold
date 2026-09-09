/**
 * Pruebas del historial local.
 *
 * No tenía ninguna, y era el módulo donde el fallo era invisible: guardaba en
 * `localStorage`, al llenarse la cuota escribía sin efecto y se tragaba el
 * error, de modo que la aplicación seguía ofreciendo recuperar versiones que
 * no existían. Ahora va a disco y los fallos se cuentan; esto fija lo que
 * promete.
 */
import assert from "node:assert/strict";

// `store.ts` arrastra `files.ts`, que mira `window` al cargarse para saber si
// está bajo Tauri. Aquí no hay ventana y da igual: la prueba inyecta su
// propio almacén.
globalThis.window = {};

// Dinámico y no estático: los `import` se elevan por encima de la línea de
// arriba, y el módulo miraría `window` antes de que exista.
const { clearHistory, historyKey, loadHistory, recordVersion, resetHistory, versionsFor } =
  await import("../src/history.ts");

function almacenEnMemoria(inicial = null) {
  const valores = new Map();
  if (inicial !== null) valores.set("history", inicial);
  return {
    escrituras: 0,
    read: async (name) => valores.get(name) ?? null,
    async write(name, contents) {
      this.escrituras += 1;
      valores.set(name, contents);
    },
    clear: async (name) => void valores.delete(name),
    crudo: () => valores.get("history") ?? null,
  };
}

/** Deja que corran los `void guardar(...)` que se lanzan sin esperar. */
const asentar = () => new Promise((resolve) => setImmediate(resolve));

// ── La clave distingue un archivo de un documento sin guardar ──────────────
assert.equal(historyKey("C:\\notas\\guia.md", "guia.md"), "C:\\notas\\guia.md");
assert.equal(historyKey(null, "Sin título"), "untitled:Sin título");

// ── Se graban versiones, la más reciente primero ───────────────────────────
{
  resetHistory();
  const almacen = almacenEnMemoria();
  await loadHistory(almacen);

  recordVersion("doc", "primera", almacen);
  recordVersion("doc", "segunda", almacen);
  await asentar();

  const versiones = versionsFor("doc");
  assert.equal(versiones.length, 2);
  assert.equal(versiones[0].content, "segunda", "la más reciente va delante");
  assert.ok(versiones[0].savedAt > 0, "cada versión lleva su hora");
  assert.notEqual(versiones[0].id, versiones[1].id, "cada versión tiene su identificador");
}

// ── Guardar sin cambiar nada no llena el historial de copias iguales ───────
{
  resetHistory();
  const almacen = almacenEnMemoria();
  await loadHistory(almacen);

  recordVersion("doc", "igual", almacen);
  await asentar();
  const escriturasTrasLaPrimera = almacen.escrituras;
  recordVersion("doc", "igual", almacen);
  await asentar();

  assert.equal(versionsFor("doc").length, 1, "no se duplica una versión idéntica");
  assert.equal(almacen.escrituras, escriturasTrasLaPrimera, "y no se toca el disco en balde");
}

// ── Un documento vacío o sin clave no gasta una versión ────────────────────
{
  resetHistory();
  const almacen = almacenEnMemoria();
  await loadHistory(almacen);
  recordVersion("doc", "   \n  ", almacen);
  recordVersion("", "algo", almacen);
  await asentar();
  assert.equal(versionsFor("doc").length, 0);
}

// ── El tope es treinta: el historial no puede crecer sin final ─────────────
{
  resetHistory();
  const almacen = almacenEnMemoria();
  await loadHistory(almacen);
  for (let n = 0; n < 45; n += 1) recordVersion("doc", `versión ${n}`, almacen);
  await asentar();

  const versiones = versionsFor("doc");
  assert.equal(versiones.length, 30, "se conservan treinta");
  assert.equal(versiones[0].content, "versión 44", "y son las últimas treinta");
  assert.equal(versiones[29].content, "versión 15");
}

// ── Lo grabado sobrevive a un arranque ─────────────────────────────────────
{
  resetHistory();
  const almacen = almacenEnMemoria();
  await loadHistory(almacen);
  recordVersion("doc", "antes de cerrar", almacen);
  await asentar();

  resetHistory();
  assert.equal(versionsFor("doc").length, 0, "sin cargar no hay nada en memoria");
  await loadHistory(almacen);
  assert.equal(versionsFor("doc")[0].content, "antes de cerrar", "y al cargar vuelve");
}

// ── Un archivo ilegible se descarta en vez de tumbar el arranque ───────────
{
  resetHistory();
  const almacen = almacenEnMemoria("{ esto no es json");
  await loadHistory(almacen);
  assert.deepEqual(versionsFor("doc"), []);
  // Y se puede seguir grabando encima: empieza de cero, no se queda roto.
  recordVersion("doc", "de nuevo", almacen);
  await asentar();
  assert.equal(versionsFor("doc").length, 1);
}

// ── Borrar el historial de un documento no toca el de los demás ────────────
{
  resetHistory();
  const almacen = almacenEnMemoria();
  await loadHistory(almacen);
  recordVersion("uno", "a", almacen);
  recordVersion("otro", "b", almacen);
  await asentar();

  clearHistory("uno", almacen);
  await asentar();
  assert.deepEqual(versionsFor("uno"), []);
  assert.equal(versionsFor("otro").length, 1, "el del otro documento sigue ahí");
}

// ── Sin haber cargado no se graba: guardaría sobre un historial vacío ──────
{
  resetHistory();
  const almacen = almacenEnMemoria();
  recordVersion("doc", "se pierde", almacen);
  await asentar();
  assert.equal(almacen.escrituras, 0, "no se escribe antes de saber qué había");
}

console.log("18 de 18 pruebas de historial correctas");
