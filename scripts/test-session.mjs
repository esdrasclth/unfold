import assert from "node:assert/strict";

// `store.ts` arrastra `files.ts`, que mira `window` al cargarse para saber si
// está bajo Tauri. Aquí no hay ventana y da igual: la prueba inyecta su
// propio almacén.
globalThis.window = {};

// Dinámico y no estático: los `import` se elevan por encima de la línea de
// arriba, y el módulo miraría `window` antes de que exista.
const { clearSession, loadSession, saveSession } = await import("../src/session.ts");

/**
 * Almacén en memoria con la forma del de disco.
 *
 * La sesión dejó de vivir en `localStorage` —donde competía por la cuota con
 * el historial y podía impedir guardar los borradores— y pasó a un archivo,
 * así que leer y escribir son ahora asíncronos.
 */
function almacenEnMemoria() {
  const valores = new Map();
  return {
    read: async (name) => valores.get(name) ?? null,
    write: async (name, contents) => void valores.set(name, contents),
    clear: async (name) => void valores.delete(name),
    /** Atajo para plantar contenido crudo en las pruebas de formato. */
    poner: (contents) => valores.set("session", contents),
  };
}

const almacen = almacenEnMemoria();
const snapshot = {
  active: 1,
  tabs: [
    {
      path: null,
      name: "Notas",
      dirty: true,
      content: "# Borrador",
      anchor: 2,
      head: 2,
      scrollTop: 18,
    },
  ],
};

await saveSession(snapshot, almacen);
assert.deepEqual(await loadSession(almacen), { ...snapshot, active: 0, version: 1 });
await clearSession(almacen);
assert.equal(await loadSession(almacen), null);

almacen.poner(JSON.stringify({ version: 99, tabs: [] }));
assert.equal(await loadSession(almacen), null, "se ignoran formatos de sesión desconocidos");
console.log("4 de 4 pruebas de sesión correctas");

const invalid = { ...snapshot.tabs[0], anchor: 1.5 };
almacen.poner(JSON.stringify({ version: 1, active: 1, tabs: [invalid, snapshot.tabs[0]] }));
assert.equal((await loadSession(almacen)).active, 0);
assert.equal((await loadSession(almacen)).tabs.length, 1);
almacen.poner(
  '{"version":1,"active":0,"tabs":[{"path":null,"name":"x","content":"a","dirty":true,"anchor":0,"head":0,"scrollTop":1e400}]}',
);
assert.equal(await loadSession(almacen), null);

// Un archivo ilegible no puede tumbar el arranque: se abre en blanco, que es
// lo que pasaba antes de que hubiera sesión que restaurar.
almacen.poner("{ esto no es json");
assert.equal(await loadSession(almacen), null, "una sesión corrupta se ignora");

// Guardar no puede propagar el fallo del disco hacia arriba: se llama al
// teclear, y una excepción ahí dejaría la aplicación a medias.
const roto = {
  read: async () => null,
  write: async () => {
    throw new Error("disco lleno");
  },
  clear: async () => {},
};
// Se silencia el aviso: el fallo se cuenta a propósito y aquí ya se está
// comprobando, así que no hace falta ensuciar la salida de las pruebas.
const avisoOriginal = console.error;
let contado = 0;
console.error = () => { contado += 1; };
await saveSession(snapshot, roto);
console.error = avisoOriginal;
assert.equal(contado, 1, "el fallo del disco se cuenta, ya no se traga en silencio");
console.log("5 pruebas adicionales de sesion correctas");
