/**
 * Pruebas de la barra de pestañas migrada a Preact.
 *
 * Lo que se comprueba sobre todo es el teclado, porque es lo que antes no
 * existía: eran `div`s sueltos, no se llegaba a ellos tabulando y no había
 * forma de recorrerlos. Si esto se rompe no se nota mirando la pantalla.
 */
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window = window;
globalThis.document = window.document;
for (const name of ["Node", "HTMLElement", "Element", "Event"]) {
  globalThis[name] = window[name];
}
window.Element.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.focus ??= function () {};

/**
 * Eventos de teclado y ratón.
 *
 * linkedom no trae `KeyboardEvent` ni `MouseEvent`, así que se compone sobre
 * `Event` con los campos que el componente mira. Es suficiente: lo que se
 * prueba es qué hace con `key` y con `button`, no la fidelidad del evento.
 */
const evento = (tipo, campos) => Object.assign(new window.Event(tipo, { bubbles: true }), campos);
// Preact programa el repintado con esto; en linkedom no viene.
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const { render } = await import("preact");
const { compilarComponente } = await import("./compile-tsx.mjs");
const { TabBar } = await compilarComponente("../src/components/tabs/TabBar.tsx");

const host = document.createElement("div");
host.id = "tab-bar";
host.setAttribute("role", "tablist");
document.body.append(host);

const DOCUMENTOS = [
  { id: 1, name: "guia.md", path: "C:/docs/guia.md", dirty: false },
  { id: 2, name: "notas.md", path: null, dirty: true },
  { id: 3, name: "README.md", path: "C:/README.md", dirty: false },
];

let activados = [];
let cerrados = [];

/** Vuelve a pintar con el id activo dado y deja el DOM listo para mirar. */
async function pintar(activeId, tabs = DOCUMENTOS) {
  render(
    TabBar({
      tabs,
      activeId,
      onActivate: (id) => activados.push(id),
      onClose: (id) => cerrados.push(id),
    }),
    host,
  );
  await new Promise((r) => setTimeout(r, 0));
}

const pestanas = () => [...host.querySelectorAll('[role="tab"]')];
const activa = () => host.querySelector('[aria-selected="true"]');

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

// --- Lo que se ve -----------------------------------------------------------

await pintar(2);
assert.equal(pestanas().length, 3);
prueba("se pinta una pestaña por documento");

assert.equal(activa()?.querySelector(".tab-name")?.textContent, "notas.md");
assert.ok(activa()?.className.includes("is-active"));
prueba("la activa se marca");

// El punto de «sin guardar» es una clase, y perderla dejaría a alguien creyendo
// que su documento está guardado cuando no lo está.
assert.ok(pestanas()[1].className.includes("is-dirty"));
assert.ok(!pestanas()[0].className.includes("is-dirty"));
prueba("las pestañas sin guardar se distinguen");

// El título completo es lo que separa dos documentos que se llaman igual.
assert.equal(pestanas()[0].getAttribute("title"), "C:/docs/guia.md");
assert.equal(pestanas()[1].getAttribute("title"), "notas.md", "sin ruta, el nombre");
prueba("el título lleva la ruta cuando la hay");

// --- Accesibilidad ----------------------------------------------------------

assert.deepEqual(
  pestanas().map((t) => t.getAttribute("aria-selected")),
  ["false", "true", "false"],
);
prueba("aria-selected sólo en la activa");

// Tabulación itinerante: una sola entrada, para no atrapar al tabulador
// obligando a recorrer veinte pestañas antes de salir de la barra.
assert.deepEqual(
  pestanas().map((t) => t.getAttribute("tabindex")),
  ["-1", "0", "-1"],
);
prueba("sólo la activa entra en la tabulación");

const aspa = pestanas()[0].querySelector("button.tab-close");
assert.ok(aspa, "el aspa es un botón de verdad");
assert.equal(aspa.getAttribute("aria-label"), "Cerrar guia.md");
assert.equal(aspa.getAttribute("tabindex"), "-1");
prueba("el aspa se nombra y se queda fuera de la tabulación");

// --- El teclado -------------------------------------------------------------

const pulsar = async (elemento, key) => {
  elemento.dispatchEvent(evento("keydown", { key, preventDefault: () => {} }));
  await new Promise((r) => setTimeout(r, 0));
};

activados = [];
await pulsar(activa(), "ArrowRight");
assert.deepEqual(activados, [3]);
prueba("la flecha derecha avanza");

activados = [];
await pulsar(activa(), "ArrowLeft");
assert.deepEqual(activados, [1]);
prueba("la flecha izquierda retrocede");

activados = [];
await pulsar(activa(), "Home");
assert.deepEqual(activados, [1]);
activados = [];
await pulsar(activa(), "End");
assert.deepEqual(activados, [3]);
prueba("Inicio y Fin van a los extremos");

// Dar la vuelta evita el callejón sin salida al final de la barra.
await pintar(3);
activados = [];
await pulsar(activa(), "ArrowRight");
assert.deepEqual(activados, [1], "desde la última se vuelve a la primera");
await pintar(1);
activados = [];
await pulsar(activa(), "ArrowLeft");
assert.deepEqual(activados, [3], "y desde la primera, a la última");
prueba("las flechas dan la vuelta");

await pintar(2);
cerrados = [];
await pulsar(activa(), "Delete");
assert.deepEqual(cerrados, [2]);
prueba("Supr cierra la pestaña con el foco");

// Cualquier otra tecla tiene que pasar de largo: la barra no puede tragarse
// pulsaciones que no son suyas.
activados = [];
cerrados = [];
await pulsar(activa(), "a");
await pulsar(activa(), "Escape");
assert.deepEqual([activados, cerrados], [[], []]);
prueba("las demás teclas no se tocan");

// --- El ratón ---------------------------------------------------------------

activados = [];
pestanas()[2].dispatchEvent(evento("click", {}));
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(activados, [3]);
prueba("hacer clic activa");

// El aspa cierra y no activa de paso: sin detener la propagación, cerrar la
// pestaña de al lado saltaría antes a ella.
activados = [];
cerrados = [];
pestanas()[0].querySelector("button.tab-close").dispatchEvent(evento("click", {}));
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual([cerrados, activados], [[1], []]);
prueba("el aspa cierra sin activar");

// --- Una sola pestaña -------------------------------------------------------

// Se ve igual con un solo documento: esconder la barra dejaba esa pestaña sin
// aspa y no había forma de cerrarla con el ratón.
await pintar(1, [DOCUMENTOS[0]]);
assert.equal(pestanas().length, 1);
assert.ok(pestanas()[0].querySelector("button.tab-close"));
prueba("con un solo documento la barra sigue ahí, con su aspa");

console.log(`${hechas} de ${hechas} pruebas de la barra de pestañas correctas`);
