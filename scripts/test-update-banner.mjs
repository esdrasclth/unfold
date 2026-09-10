/**
 * Pruebas de la tarjeta de actualización.
 *
 * Lo que más importa aquí es que «Más tarde» y «Omitir esta versión» sigan
 * siendo dos acciones distintas: estuvieron confundidas en un mismo botón, y
 * quien lo pulsaba esperando que se lo recordaran no volvía a saber de esa
 * versión nunca.
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
const { UpdateBanner, novedades, megasDescargados } = await compilarComponente(
  "../src/components/updates/UpdateBanner.tsx",
);

const host = document.createElement("div");
document.body.append(host);

let acciones = [];
const BASE = {
  status: "idle",
  version: "0.6.0",
  notes: "",
  reason: "",
  downloaded: 0,
  total: null,
};

const pintar = (props) => {
  render(UpdateBanner({ ...BASE, ...props, onAction: (a) => acciones.push(a) }), host);
};
const boton = (texto) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === texto);
const clic = (elemento) => elemento.dispatchEvent(new window.Event("click", { bubbles: true }));

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

// --- Las novedades ----------------------------------------------------------

assert.deepEqual(novedades("- una\n- dos"), ["una", "dos"]);
assert.deepEqual(novedades("* con asterisco"), ["con asterisco"], "también con asterisco");
assert.deepEqual(novedades("sin viñeta"), ["sin viñeta"]);
prueba("las viñetas del manifiesto se limpian");

// Tres como mucho: es un aviso en una esquina, no las notas de la versión.
assert.deepEqual(novedades("- 1\n- 2\n- 3\n- 4\n- 5"), ["1", "2", "3"]);
prueba("no pasan de tres");

// Los encabezados del manifiesto no son novedades, y las líneas en blanco de
// separación tampoco.
assert.deepEqual(novedades("## Título\n\n- una\n\n- dos"), ["una", "dos"]);
prueba("los títulos y los huecos se saltan");

// --- La descarga ------------------------------------------------------------

assert.equal(megasDescargados(1024 * 1024, 5 * 1024 * 1024), "1.0 de 5.0 MB");
// Sin tamaño total no se puede prometer un final, así que se cuenta lo que va.
assert.equal(megasDescargados(2 * 1024 * 1024, null), "2.0 MB descargados");
prueba("la descarga se cuenta en megas");

// --- Nada que enseñar -------------------------------------------------------

pintar({ status: "idle" });
assert.equal(host.innerHTML.trim(), "", "en reposo no deja ni un nodo");
prueba("en reposo no pinta nada");

// --- Versión disponible -----------------------------------------------------

pintar({ status: "available", notes: "- Primera\n- Segunda" });
assert.equal(host.querySelector("strong").textContent, "Unfold 0.6.0");
assert.deepEqual([...host.querySelectorAll("li")].map((l) => l.textContent), ["Primera", "Segunda"]);
prueba("se enseñan la versión y sus novedades");

// Sin novedades no se deja una lista vacía colgando.
pintar({ status: "available", notes: "" });
assert.equal(host.querySelector("ul"), null);
prueba("sin novedades no hay lista");

acciones = [];
clic(boton("Reiniciar e instalar"));
clic(boton("Más tarde"));
clic(boton("Omitir esta versión"));
assert.deepEqual(acciones, ["instalar", "tarde", "omitir"]);
prueba("cada botón pide lo suyo");

// El aspa aparta, no descarta: es lo mismo que «Más tarde» y no lo que hacía
// antes, que era guardar la versión como omitida para siempre.
acciones = [];
clic(host.querySelector(".update-card-close"));
assert.deepEqual(acciones, ["tarde"]);
assert.equal(host.querySelector(".update-card-close").getAttribute("aria-label"), "Más tarde");
prueba("el aspa aparta y no descarta");

// --- Instalando -------------------------------------------------------------

pintar({ status: "installing", downloaded: 0, total: null });
assert.match(host.querySelector(".update-card-progress-text").textContent, /Preparando/);
prueba("antes del primer byte se dice que está preparando");

pintar({ status: "installing", downloaded: 1024 * 1024, total: 4 * 1024 * 1024 });
const barra = host.querySelector(".update-card-bar");
assert.equal(barra.getAttribute("role"), "progressbar");
assert.equal(barra.getAttribute("aria-valuenow"), "25");
assert.match(barra.querySelector("span").getAttribute("style"), /width:25%/);
prueba("la barra dice por dónde va");

// Sin tamaño total, una barra sin valor es cómo se dice «avanza, pero no sé
// cuánto falta». Inventarse un porcentaje sería peor.
pintar({ status: "installing", downloaded: 1024, total: null });
assert.equal(host.querySelector(".update-card-bar").getAttribute("aria-valuenow"), null);
prueba("sin tamaño total la barra queda indeterminada");

// Instalando no se puede cerrar: la descarga sigue y cerrar no la para.
assert.equal(host.querySelector(".update-card-close"), null);
prueba("mientras instala no hay aspa");

// --- Fallo ------------------------------------------------------------------

pintar({ status: "error", reason: "No hay conexión" });
assert.equal(host.querySelector(".update-card-reason").textContent, "No hay conexión");
acciones = [];
clic(boton("Reintentar"));
assert.deepEqual(acciones, ["reintentar"]);
prueba("el fallo dice el motivo y deja reintentar");

// Aquí el aspa sí cierra del todo: no hay versión pendiente que apartar.
acciones = [];
clic(host.querySelector(".update-card-close"));
assert.deepEqual(acciones, ["cerrar"]);
prueba("tras un fallo el aspa cierra");

console.log(`${hechas} de ${hechas} pruebas de la tarjeta de actualización correctas`);
