/**
 * Pruebas del menú de documentos recientes.
 *
 * La fila dice la carpeta y cuándo se abrió porque es lo único que distingue
 * dos `README.md` de proyectos distintos; si eso se pierde, la lista deja de
 * servir sin que nada parezca roto.
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
const { RecentMenu } = await compilarComponente("../src/components/recent/RecentMenu.tsx");

const host = document.createElement("div");
document.body.append(host);

let abiertos = [];
let olvidados = [];
let buscados = 0;

const AHORA = Date.now();
const FICHEROS = [
  { path: "C:/proyectos/unfold/README.md", name: "README.md", opened: AHORA - 12 * 60_000 },
  { path: "C:/proyectos/otro/README.md", name: "README.md", opened: AHORA - 3 * 3_600_000 },
];

const pintar = (files) =>
  render(
    RecentMenu({
      files,
      onOpen: (p) => abiertos.push(p),
      onForget: (p) => olvidados.push(p),
      onBrowse: () => (buscados += 1),
    }),
    host,
  );

const opciones = () => [...host.querySelectorAll('[role="menuitem"]')];
const clic = (elemento) => elemento.dispatchEvent(new window.Event("click", { bubbles: true }));

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

// --- La lista ---------------------------------------------------------------

pintar(FICHEROS);
assert.equal(opciones().length, 3, "dos documentos y la acción de buscar");
assert.equal(host.querySelector(".menu-head").textContent, "Recientes");
prueba("se pinta la lista con su acción al final");

// Dos documentos con el mismo nombre: lo que los separa es la carpeta.
const metas = [...host.querySelectorAll(".menu-item-meta")].map((m) => m.textContent);
assert.match(metas[0], /^unfold · /);
assert.match(metas[1], /^otro · /);
prueba("la carpeta distingue los homónimos");

// Y el «cuándo», que sitúa cuál se usó antes.
assert.match(metas[0], /hace 12 min$/);
assert.match(metas[1], /hace 3 h$/);
prueba("se dice cuándo se abrió cada uno");

// La ruta entera va en el título: no cabe en la fila pero hace falta.
assert.equal(opciones()[0].getAttribute("title"), "C:/proyectos/unfold/README.md");
prueba("la ruta completa va en el título");

// --- Accesibilidad ----------------------------------------------------------

assert.ok(opciones().every((o) => o.tagName === "BUTTON"));
assert.equal(
  host.querySelector(".menu-item-forget").getAttribute("aria-label"),
  "Quitar README.md de la lista",
);
prueba("las filas son botones y el aspa se nombra");

// --- Lo que hace ------------------------------------------------------------

abiertos = [];
clic(opciones()[1]);
assert.deepEqual(abiertos, ["C:/proyectos/otro/README.md"]);
prueba("hacer clic en una fila la abre");

// Quitar de la lista no puede abrir el documento de paso: sin detener la
// propagación, el clic llegaría también a la fila que lo contiene.
abiertos = [];
olvidados = [];
clic(host.querySelector(".menu-item-forget"));
assert.deepEqual([olvidados, abiertos], [["C:/proyectos/unfold/README.md"], []]);
prueba("el aspa quita sin abrir");

buscados = 0;
clic(opciones().at(-1));
assert.equal(buscados, 1);
prueba("la última fila abre el explorador del sistema");

// --- Sin nada ---------------------------------------------------------------

// Recién instalado no hay recientes, y una lista vacía sin explicación parece
// una avería. La acción de buscar tiene que seguir estando.
pintar([]);
assert.equal(host.querySelector(".menu-empty").textContent, "Todavía no has abierto ningún archivo.");
assert.equal(opciones().length, 1);
assert.equal(opciones()[0].textContent.trim(), "Buscar en el disco…");
prueba("sin recientes se explica, y se puede buscar igual");

console.log(`${hechas} de ${hechas} pruebas del menú de recientes correctas`);
