/**
 * La CSP de la aplicación empaquetada.
 *
 * Esto no comprueba código: comprueba una casilla de configuración que, mal
 * puesta, deja la aplicación instalada inservible sin que ninguna otra prueba
 * se entere. En desarrollo el frontend se sirve desde el servidor de Vite y la
 * CSP no se aplica igual, así que el fallo sólo aparece compilando, instalando
 * y abriendo.
 *
 * Lo que pasó en 0.5.4: Tauri analiza los recursos al compilar y añade un
 * `nonce` al `style-src`. Por especificación, un nonce hace que
 * `'unsafe-inline'` se ignore por completo, de modo que quedaron bloqueados
 * los estilos que la aplicación necesita inyectar en caliente: el tema de
 * CodeMirror —que es de donde salen el desplazamiento del editor, el ancho de
 * la columna y el tamaño y el interlineado del texto— y los estilos en línea
 * con los que se aplican las preferencias. La aplicación arrancaba, se veía
 * rara y no obedecía al panel de apariencia.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const seguridad = conf.app.security;
const csp = seguridad.csp ?? "";
let hechas = 0;
const check = (condicion, mensaje) => {
  hechas += 1;
  assert.ok(condicion, mensaje);
};

const directiva = (nombre) => {
  const trozo = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${nombre} `));
  return trozo ?? null;
};

const estilos = directiva("style-src");
check(estilos !== null, "la CSP declara style-src");

// Si el style-src confía en los estilos en línea, Tauri no puede añadirle un
// nonce: el nonce los desactivaría justo a todos.
if (estilos.includes("'unsafe-inline'")) {
  const sinTocar = seguridad.dangerousDisableAssetCspModification;
  check(
    sinTocar === true || (Array.isArray(sinTocar) && sinTocar.includes("style-src")),
    "con 'unsafe-inline' en style-src, hay que sacar style-src de lo que Tauri modifica, " +
      "o el nonce que inyecta al compilar lo anula y la aplicación instalada pierde el " +
      "tema de CodeMirror y las preferencias",
  );
}

// El IPC de Tauri viaja por su propio protocolo. Sin connect-src que lo
// permita, la petición se bloquea y Tauri cae al respaldo por postMessage:
// funciona, pero por el camino lento y llenando la consola de errores.
const conexiones = directiva("connect-src");
check(conexiones !== null, "la CSP declara connect-src en lugar de dejarlo caer en default-src");
check(conexiones.includes("ipc:"), "connect-src permite el protocolo ipc:");
check(
  conexiones.includes("http://ipc.localhost"),
  "connect-src permite http://ipc.localhost, que es por donde va el IPC en Windows",
);

console.log(`${hechas} de ${hechas} pruebas de la CSP correctas`);
