import assert from "node:assert/strict";

/**
 * Pruebas del aviso de versión nueva.
 *
 * Es el módulo que decide si te enteras de que hay una actualización, y todo lo
 * que hace mal lo hace en silencio: si se equivoca, nadie recibe la versión y
 * nadie se entera de que no la ha recibido. Por eso se prueban sobre todo los
 * casos en que la respuesta correcta es «no avisar»: son los que, si fallan al
 * revés, dejan a la gente sin actualizar para siempre.
 *
 * El plugin de Tauri habla por `invoke`, que va a `window.__TAURI_INTERNALS__`,
 * así que se suplanta ahí y no hace falta interceptar el módulo.
 */

const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => almacen.get(k) ?? null,
  setItem: (k, v) => void almacen.set(k, String(v)),
  removeItem: (k) => void almacen.delete(k),
};

/** Lo que responderá el lado nativo a la próxima comprobación. */
let respuesta = null;
let falla = false;
const llamadas = [];

globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: (cmd, args) => {
      llamadas.push({ cmd, args });
      if (falla) return Promise.reject(new Error("la red dijo que no"));
      if (cmd === "plugin:updater|check") return Promise.resolve(respuesta);
      return Promise.resolve(null);
    },
    transformCallback: (fn) => fn,
  },
};

const { buscarActualizacion, omitirVersion, restablecerVersionOmitida } =
  await import("../src/updates.ts");

/** Un manifiesto como el que devuelve el lado nativo cuando hay versión nueva. */
const hay = (version, body = "Novedades\nsegunda línea") => ({
  rid: 1,
  available: true,
  currentVersion: "0.5.0",
  version,
  date: "2026-09-10",
  body,
  rawJson: {},
});

function manejadores() {
  const visto = { avisos: [], errores: [], progreso: [] };
  return {
    visto,
    onAvailable: (v, n) => visto.avisos.push({ version: v, notas: n }),
    onError: (m) => visto.errores.push(m),
    onProgress: (d, t) => visto.progreso.push([d, t]),
  };
}

const CLAVE_ULTIMA = "unfold:ultima-comprobacion";
const CLAVE_OMITIDA = "unfold:version-omitida";

let hechas = 0;
async function prueba(nombre, fn) {
  almacen.clear();
  llamadas.length = 0;
  respuesta = null;
  falla = false;
  await fn();
  hechas += 1;
  void nombre;
}

// --- Cuando sí hay que avisar ----------------------------------------------

await prueba("una versión nueva se anuncia con sus notas", async () => {
  respuesta = hay("0.6.0");
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), true);
  assert.deepEqual(h.visto.avisos, [{ version: "0.6.0", notas: "Novedades\nsegunda línea" }]);
  assert.deepEqual(h.visto.errores, []);
});

// Un manifiesto sin notas no puede impedir el aviso: lo que importa es que hay
// versión nueva, no que venga descrita.
await prueba("sin notas se avisa igual", async () => {
  respuesta = { ...hay("0.6.0"), body: undefined };
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), true);
  assert.equal(h.visto.avisos[0].notas, "");
});

await prueba("no habiendo versión nueva no se molesta a nadie", async () => {
  respuesta = null;
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), false);
  assert.deepEqual(h.visto.avisos, []);
  assert.deepEqual(h.visto.errores, [], "«no hay nada» no es un error");
});

// --- La ventana entre comprobaciones ---------------------------------------

// Se consulta como mucho cada cuarto de hora: sin esto, cada arranque de una
// sesión larga saldría a la red sin motivo.
await prueba("no se consulta dos veces seguidas", async () => {
  respuesta = hay("0.6.0");
  await buscarActualizacion(manejadores());
  const antes = llamadas.length;
  assert.equal(await buscarActualizacion(manejadores()), false);
  assert.equal(llamadas.length, antes, "la segunda ni sale a la red");
});

await prueba("pasado el cuarto de hora se vuelve a consultar", async () => {
  respuesta = hay("0.6.0");
  await buscarActualizacion(manejadores());
  almacen.set(CLAVE_ULTIMA, String(Date.now() - 16 * 60 * 1000));
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), true);
  assert.equal(h.visto.avisos.length, 1);
});

// Pedirlo a mano desde los ajustes tiene que consultar siempre: quien pulsa el
// botón espera una respuesta ahora, no dentro de un rato.
await prueba("pedirlo a mano salta la ventana", async () => {
  respuesta = hay("0.6.0");
  await buscarActualizacion(manejadores());
  const h = manejadores();
  assert.equal(await buscarActualizacion(h, true), true);
  assert.equal(h.visto.avisos.length, 1);
});

// --- Versiones omitidas -----------------------------------------------------

await prueba("una versión omitida no se vuelve a anunciar sola", async () => {
  respuesta = hay("0.6.0");
  omitirVersion("0.6.0");
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), false);
  assert.deepEqual(h.visto.avisos, []);
});

// Pedirlo a mano sí la enseña, y tiene que ser así: quien pulsa «Buscar
// actualizaciones» pregunta por lo que hay, no por lo que no descartó.
await prueba("pedirlo a mano enseña incluso lo omitido", async () => {
  respuesta = hay("0.6.0");
  omitirVersion("0.6.0");
  const h = manejadores();
  assert.equal(await buscarActualizacion(h, true), true);
  assert.equal(h.visto.avisos[0].version, "0.6.0");
});

// Omitir la 0.6.0 no puede callar la 0.7.0: si lo hiciera, decir «esta no» una
// sola vez dejaría a esa persona sin actualizar nunca más.
await prueba("omitir una versión no silencia las siguientes", async () => {
  omitirVersion("0.6.0");
  respuesta = hay("0.7.0");
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), true);
  assert.equal(h.visto.avisos[0].version, "0.7.0");
});

await prueba("se puede deshacer haber omitido una versión", async () => {
  respuesta = hay("0.6.0");
  omitirVersion("0.6.0");
  restablecerVersionOmitida();
  assert.equal(almacen.get(CLAVE_OMITIDA), undefined);
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), true);
});

// --- Cuando la red falla ----------------------------------------------------

// Esto es lo que no puede pasar en silencio: si la comprobación falla y nadie
// lo dice, la aplicación parece estar al día cuando no lo está.
await prueba("un fallo de red se cuenta, no se traga", async () => {
  falla = true;
  const h = manejadores();
  const avisoOriginal = console.error;
  console.error = () => {};
  assert.equal(await buscarActualizacion(h, true), false);
  console.error = avisoOriginal;
  assert.equal(h.visto.errores.length, 1);
  assert.match(h.visto.errores[0], /conexión/i);
});

// Un fallo no debe marcar la comprobación como hecha: si lo hiciera, un corte de
// red de un segundo dejaría a la aplicación sin volver a mirar en un cuarto de
// hora, y al reintentar en seguida no pasaría nada.
await prueba("un fallo no consume la ventana de comprobación", async () => {
  falla = true;
  const avisoOriginal = console.error;
  console.error = () => {};
  await buscarActualizacion(manejadores(), true);
  console.error = avisoOriginal;
  assert.equal(almacen.get(CLAVE_ULTIMA), undefined, "no se apunta como comprobado");

  falla = false;
  respuesta = hay("0.6.0");
  const h = manejadores();
  assert.equal(await buscarActualizacion(h), true, "el reintento sale a la red");
});

console.log(`${hechas} de ${hechas} pruebas del aviso de actualización correctas`);
