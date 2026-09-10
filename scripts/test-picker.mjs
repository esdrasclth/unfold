/**
 * Pruebas de la paleta de comandos y de la búsqueda global.
 *
 * Son el mismo cuadro con distinto contenido, así que comparten armazón. Lo que
 * se comprueba de fondo es que la selección la lleve la lista y no el foco del
 * navegador: el foco se queda en el campo para poder seguir escribiendo
 * mientras se recorre con las flechas.
 */
import assert from "node:assert/strict";
import { crearDom, evento } from "./dom-preact.mjs";

crearDom();

const { render } = await import("preact");
// En un solo paquete: comparten el armazón, y así lo comparten de verdad.
const { compilarJuntos } = await import("./compile-tsx.mjs");
const { CommandPalette, filtrar, SearchDocuments, recuento } = await compilarJuntos([
  "../src/components/dialogs/CommandPalette.tsx",
  "../src/components/dialogs/SearchDocuments.tsx",
]);

const host = document.createElement("div");
document.body.append(host);

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

const ACCIONES = [
  { id: "new", label: "Nuevo documento", shortcut: "Ctrl+N", run: () => {} },
  { id: "open", label: "Abrir documento", shortcut: "Ctrl+O", run: () => {} },
  { id: "publish", label: "Publicar cambios en GitHub", run: () => {} },
];

// --- Filtrar ----------------------------------------------------------------

assert.equal(filtrar(ACCIONES, "").length, 3, "sin escribir nada están todas");
assert.deepEqual(filtrar(ACCIONES, "documento").map((a) => a.id), ["new", "open"]);
assert.deepEqual(filtrar(ACCIONES, "GITHUB").map((a) => a.id), ["publish"], "sin distinguir caja");
assert.deepEqual(filtrar(ACCIONES, "  publicar  ").map((a) => a.id), ["publish"], "y sin los bordes");
prueba("el filtro busca dentro del rótulo");

// --- La paleta --------------------------------------------------------------

let ejecutadas = [];
let cerrada = 0;
let consulta = "";
let activa = 0;

const pintarPaleta = () =>
  render(
    CommandPalette({
      actions: ACCIONES,
      query: consulta,
      activeIndex: activa,
      onQuery: (q) => {
        consulta = q;
        activa = 0;
        pintarPaleta();
      },
      onActive: (i) => {
        activa = i;
        pintarPaleta();
      },
      onRun: (accion) => ejecutadas.push(accion.id),
      onClose: () => (cerrada += 1),
    }),
    host,
  );

const filas = () => [...host.querySelectorAll(".command-palette-item")];
const seleccionada = () =>
  host.querySelector('.command-palette-item[aria-selected="true"] .command-palette-label')
    ?.textContent;

pintarPaleta();
assert.equal(filas().length, 3);
assert.equal(seleccionada(), "Nuevo documento", "la primera va seleccionada");
prueba("se pintan las acciones con la primera elegida");

// El atajo se enseña porque la paleta es donde se descubren: quien la usa dos
// veces para lo mismo ya sabe cómo no volver a abrirla.
assert.deepEqual(
  [...filas()[0].querySelectorAll(".command-palette-keys kbd")].map((k) => k.textContent),
  ["Ctrl", "N"],
);
assert.equal(filas()[2].querySelector(".command-palette-keys"), null, "sin atajo, no hay hueco");
prueba("cada acción enseña su atajo, si lo tiene");

// --- Escribir ---------------------------------------------------------------

const campo = () => host.querySelector(".command-palette-input");
const escribir = (texto) => {
  const input = campo();
  Object.defineProperty(input, "value", { value: texto, configurable: true });
  input.dispatchEvent(evento("input"));
};

escribir("github");
assert.equal(filas().length, 1);
assert.equal(seleccionada(), "Publicar cambios en GitHub");
prueba("escribir filtra");

// El resaltado explica por qué esa fila está en la lista.
assert.equal(host.querySelector(".command-palette-item mark").textContent, "GitHub");
prueba("se resalta el trozo que coincide");

escribir("nada de esto");
assert.equal(filas().length, 0);
assert.match(host.querySelector(".command-palette-empty").textContent, /Ninguna acción coincide/);
prueba("sin coincidencias se dice cuál no coincide");

// --- El teclado -------------------------------------------------------------

escribir("");
const teclear = (key) => campo().dispatchEvent(evento("keydown", { key }));

teclear("ArrowDown");
assert.equal(seleccionada(), "Abrir documento");
teclear("ArrowUp");
assert.equal(seleccionada(), "Nuevo documento");
prueba("las flechas mueven la selección");

// Dan la vuelta: llegar al final y quedarse ahí es un callejón sin salida.
teclear("ArrowUp");
assert.equal(seleccionada(), "Publicar cambios en GitHub", "hacia arriba desde la primera");
teclear("ArrowDown");
assert.equal(seleccionada(), "Nuevo documento", "y hacia abajo desde la última");
prueba("la selección da la vuelta");

ejecutadas = [];
teclear("Enter");
assert.deepEqual(ejecutadas, ["new"]);
prueba("Enter ejecuta la seleccionada");

// Filtrar vuelve a empezar: seguir en la fila cuarta de otra lista distinta no
// significa nada.
teclear("ArrowDown");
teclear("ArrowDown");
escribir("documento");
assert.equal(seleccionada(), "Nuevo documento");
prueba("al filtrar, la selección vuelve arriba");

ejecutadas = [];
filas()[1].dispatchEvent(evento("click"));
assert.deepEqual(ejecutadas, ["open"]);
prueba("hacer clic ejecuta esa");

// Apuntar con el ratón mueve la selección: si no, habría dos marcadas a la vez.
filas()[1].dispatchEvent(evento("mousemove"));
assert.equal(seleccionada(), "Abrir documento");
prueba("apuntar con el ratón selecciona");

// --- La búsqueda ------------------------------------------------------------

assert.equal(recuento(1, false), "1 resultado");
assert.equal(recuento(4, false), "4 resultados");
// Con el tope alcanzado hay más de lo que se enseña, y decir «300» sería falso.
assert.equal(recuento(300, true), "300+ resultados");
prueba("el recuento distingue el tope alcanzado");

const HIT = (relative, line, from, to, text) => ({
  rootId: 1,
  rootName: "unfold/notas",
  path: `C:/repo/${relative}`,
  relative,
  line,
  text,
  from,
  to,
});
const HITS = [
  HIT("docs/guia.md", 12, 6, 12, "Antes archivo de cada uno"),
  HIT("docs/guia.md", 40, 0, 7, "archivo suelto"),
  HIT("README.md", 3, 3, 10, "Un archivo más"),
];

let abiertos = [];
let activaHit = 0;
const pintarBuscador = () =>
  render(
    SearchDocuments({
      query: "archivo",
      hits: HITS,
      truncated: false,
      notice: null,
      activeIndex: activaHit,
      onQuery: () => {},
      onActive: (i) => {
        activaHit = i;
        pintarBuscador();
      },
      onOpen: (hit) => abiertos.push(`${hit.relative}:${hit.line}`),
      onClose: () => {},
    }),
    host,
  );

pintarBuscador();
assert.equal(host.querySelectorAll(".buscador-hit").length, 3);
prueba("se pinta una fila por coincidencia");

// Agrupadas por archivo: lo que se decide primero es a qué documento ir, no a
// qué línea. Dos coincidencias del mismo archivo comparten una sola cabecera.
assert.deepEqual(
  [...host.querySelectorAll(".buscador-archivo strong")].map((s) => s.textContent),
  ["docs/guia.md", "README.md"],
);
prueba("los resultados se agrupan por archivo");

assert.equal(host.querySelector(".buscador-hit mark").textContent, "archiv");
assert.equal(host.querySelector(".buscador-linea").textContent, "12");
prueba("cada fila dice su línea y resalta lo encontrado");

// Las flechas recorren coincidencias, no cabeceras: las cabeceras no son
// elegibles aunque estén entre medias.
const activaLinea = () =>
  host.querySelector('.buscador-hit[aria-selected="true"] .buscador-linea')?.textContent;
assert.equal(activaLinea(), "12");
host.querySelectorAll(".buscador-hit")[2].dispatchEvent(evento("mousemove"));
assert.equal(activaLinea(), "3");
prueba("la selección salta de coincidencia en coincidencia");

abiertos = [];
host.querySelectorAll(".buscador-hit")[1].dispatchEvent(evento("click"));
assert.deepEqual(abiertos, ["docs/guia.md:40"], "se abre por su línea, no por su orden");
prueba("abrir un resultado lleva a su línea");

assert.equal(cerrada, 0, "nada de esto cerró el cuadro por su cuenta");
console.log(`${hechas} de ${hechas} pruebas del cuadro de elegir correctas`);
