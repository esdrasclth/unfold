/**
 * Pruebas de los controles de ventana.
 *
 * La ventana no tiene decoración del sistema, así que estos tres botones son la
 * única forma de minimizar, maximizar y cerrar. Si uno deja de responder no hay
 * plan B, y no se nota mirando: se nota al intentar usarlo.
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
const { WindowControls, glyph } = await compilarComponente(
  "../src/components/window/WindowControls.tsx",
);

const host = document.createElement("div");
document.body.append(host);

const hechos = { min: 0, max: 0, close: 0 };
const pintar = (maximized) =>
  render(
    WindowControls({
      maximized,
      onMinimize: () => (hechos.min += 1),
      onToggleMaximize: () => (hechos.max += 1),
      onClose: () => (hechos.close += 1),
    }),
    host,
  );
const boton = (id) => host.querySelector(`#${id}`);
const clic = (elemento) => elemento.dispatchEvent(new window.Event("click", { bubbles: true }));

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

pintar(false);
assert.deepEqual(
  [...host.querySelectorAll("button")].map((b) => b.id),
  ["win-min", "win-max", "win-close"],
  "y en ese orden, que es donde los busca la mano",
);
prueba("están los tres botones");

// Sin decoración del sistema no hay texto en ninguno: si falta la etiqueta,
// un lector de pantalla anuncia tres botones sin nombre.
for (const id of ["win-min", "win-max", "win-close"]) {
  assert.ok(boton(id).getAttribute("aria-label"), `${id} sin etiqueta`);
  assert.ok(boton(id).querySelector("svg"), `${id} sin icono`);
}
prueba("cada uno se nombra y lleva su icono");

// El de cerrar se distingue por clase: es el que se pone rojo al pasar por
// encima, y confundirlo con los otros dos sería fácil de hacer y grave.
assert.ok(boton("win-close").className.includes("is-close"));
assert.ok(!boton("win-min").className.includes("is-close"));
prueba("el de cerrar va marcado aparte");

// Maximizar y restaurar son el mismo botón con dos caras.
assert.equal(boton("win-max").getAttribute("title"), "Maximizar");
assert.equal(boton("win-max").innerHTML, glyph("maximize"));
pintar(true);
assert.equal(boton("win-max").getAttribute("title"), "Restaurar");
assert.equal(boton("win-max").getAttribute("aria-label"), "Restaurar");
assert.equal(boton("win-max").innerHTML, glyph("restore"));
prueba("maximizado enseña restaurar, y al revés");

clic(boton("win-min"));
clic(boton("win-max"));
clic(boton("win-close"));
assert.deepEqual(hechos, { min: 1, max: 1, close: 1 });
prueba("cada botón hace lo suyo");

// Repintar no puede duplicar manejadores: con `innerHTML` era fácil dejar dos
// escuchas sobre el mismo botón y cerrar la ventana con un solo clic doble.
pintar(false);
pintar(true);
clic(boton("win-close"));
assert.equal(hechos.close, 2, "un clic, una vez");
prueba("repintar no duplica lo que escucha");

console.log(`${hechas} de ${hechas} pruebas de los controles de ventana correctas`);
