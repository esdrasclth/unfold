/**
 * Pruebas del esquema del documento.
 *
 * El sangrado es relativo al nivel más alto presente: un documento que empieza
 * en H2 no puede aparecer sangrado sin motivo, y eso se rompe sin que nada
 * parezca roto.
 */
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window = window;
globalThis.document = window.document;
for (const name of ["Node", "HTMLElement", "Element", "Event"]) globalThis[name] = window[name];
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

const { render } = await import("preact");
const { compilarComponente } = await import("./compile-tsx.mjs");
const { OutlineList } = await compilarComponente("../src/components/outline/OutlineList.tsx");

const host = document.createElement("nav");
document.body.append(host);

let idos = [];
const pintar = (headings, activeIndex = -1) =>
  render(OutlineList({ headings, activeIndex, onGo: (from) => idos.push(from) }), host);
const items = () => [...host.querySelectorAll(".outline-item")];
const clic = (elemento) => elemento.dispatchEvent(new window.Event("click", { bubbles: true }));

let hechas = 0;
const prueba = (nombre) => { hechas += 1; void nombre; };

const DOC = [
  { level: 1, text: "Guía de estilo", from: 0 },
  { level: 2, text: "Antes de publicar", from: 120 },
  { level: 3, text: "Detalle", from: 300 },
  { level: 6, text: "Muy hondo", from: 400 },
];

pintar(DOC);
assert.deepEqual(items().map((i) => i.textContent), DOC.map((h) => h.text));
prueba("se pinta un encabezado por fila");

// El sangrado es relativo, y se corta a tres: más allá la lista se iría toda
// al margen derecho.
assert.deepEqual(
  items().map((i) => i.className.match(/level-\d/)[0]),
  ["level-0", "level-1", "level-2", "level-3"],
);
prueba("el sangrado es relativo y tiene tope");

// Un documento que empieza en H2 no puede salir sangrado: el nivel más alto
// presente es el que marca el margen.
pintar([
  { level: 2, text: "Primera", from: 0 },
  { level: 3, text: "Dentro", from: 50 },
]);
assert.deepEqual(items().map((i) => i.className.match(/level-\d/)[0]), ["level-0", "level-1"]);
prueba("empezar en H2 no sangra de más");

// Un encabezado sin texto sigue siendo un sitio del documento al que ir.
pintar([{ level: 1, text: "", from: 7 }]);
assert.equal(items()[0].textContent, "(sin título)");
idos = [];
clic(items()[0]);
assert.deepEqual(idos, [7], "y se puede pulsar igual");
prueba("un encabezado vacío se enseña y se puede pulsar");

// --- Dónde estás ------------------------------------------------------------

pintar(DOC, 1);
assert.equal(items()[1].getAttribute("aria-current"), "true");
assert.ok(items()[1].className.includes("is-active"));
assert.equal(items()[0].getAttribute("aria-current"), null);
prueba("el encabezado del cursor se marca y se anuncia");

// Tabulación itinerante: recorrer treinta encabezados con el tabulador para
// salir del panel sería peor que no llegar a ellos.
assert.deepEqual(items().map((i) => i.getAttribute("tabindex")), ["-1", "0", "-1", "-1"]);
prueba("sólo el activo entra en la tabulación");

// Con el cursor antes del primer encabezado no hay activo, pero el panel tiene
// que seguir siendo alcanzable con el teclado.
pintar(DOC, -1);
assert.deepEqual(items().map((i) => i.getAttribute("tabindex")), ["0", "-1", "-1", "-1"]);
assert.ok(!items().some((i) => i.getAttribute("aria-current")));
prueba("sin activo, la primera fila guarda la entrada");

// --- Ir ---------------------------------------------------------------------

idos = [];
clic(items()[2]);
assert.deepEqual(idos, [300], "se va a la posición del encabezado, no a su índice");
prueba("pulsar lleva a su posición");

// --- Sin encabezados --------------------------------------------------------

pintar([]);
assert.equal(items().length, 0);
assert.equal(
  host.querySelector(".outline-empty").textContent,
  "Los encabezados del documento aparecerán aquí.",
);
prueba("un documento sin encabezados explica el panel vacío");

console.log(`${hechas} de ${hechas} pruebas del esquema correctas`);
