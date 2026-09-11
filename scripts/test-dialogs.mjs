/**
 * Pruebas del armazón de diálogos.
 *
 * Lo que se comprueba es lo que no se ve: que Escape cierre el de arriba y no
 * el de abajo, que el fondo quede aislado mientras dure, que al cerrar vuelva
 * el foco donde estaba, y que no quede ni un oyente suelto. Nada de eso se
 * nota mirando la pantalla, y todo se nota usándolo con el teclado.
 */
import assert from "node:assert/strict";
import { h, render } from "preact";
import { crearDom, evento } from "./dom-preact.mjs";

crearDom();

const { compilarJuntos } = await import("./compile-tsx.mjs");
const { confirmDialog, vaciarLaPila, DialogHost, dialogSnapshot, subscribeDialogs } = await compilarJuntos([
  "../src/ui/confirmDialog.ts",
  "../src/components/dialogs/stack.ts",
  "../src/components/dialogs/DialogHost.tsx",
  "../src/ui/dialogs.ts",
]);

const app = document.createElement("div");
document.body.append(app);
const pintarDialogos = (dialogs) => render(
  h("div", null,
    h("main", { id: "test-background" }),
    h(DialogHost, { dialogs }),
  ),
  app,
);
pintarDialogos(dialogSnapshot());
subscribeDialogs(pintarDialogos);

const teclear = (key) => document.dispatchEvent(evento("keydown", { key }));
const esperar = () => new Promise((r) => setTimeout(r, 0));
const dialogos = () => [...document.querySelectorAll(".dialog-backdrop")];

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

const OPCIONES = [
  { label: "Guardar", value: "save", primary: true },
  { label: "Descartar", value: "discard" },
  { label: "Cancelar", value: "cancel", cancel: true },
];

// --- Lo que se enseña -------------------------------------------------------

let respuesta = confirmDialog("Cambios sin guardar", "guia.md tiene cambios.", OPCIONES);
await esperar();

assert.equal(dialogos().length, 1);
const panel = document.querySelector(".dialog");
assert.equal(panel.getAttribute("role"), "alertdialog");
assert.equal(panel.getAttribute("aria-modal"), "true");
assert.equal(panel.getAttribute("aria-label"), "Cambios sin guardar");
prueba("el diálogo se anuncia como lo que es");

// Título y mensaje van como texto: llevan el nombre del archivo, que viene del
// disco y puede ser cualquier cosa.
assert.equal(document.querySelector(".dialog-title").textContent, "Cambios sin guardar");
assert.equal(document.querySelector(".dialog-message").textContent, "guia.md tiene cambios.");
prueba("título y mensaje son texto");

assert.deepEqual(
  [...document.querySelectorAll(".dialog-button")].map((b) => b.textContent),
  ["Guardar", "Descartar", "Cancelar"],
);
assert.ok(document.querySelector(".dialog-button.is-primary").textContent === "Guardar");
prueba("las tres salidas están, y la principal se distingue");

// --- Responder --------------------------------------------------------------

document.querySelector(".dialog-button.is-primary").dispatchEvent(
  evento("click"),
);
assert.equal(await respuesta, "save");
await esperar();
assert.equal(dialogos().length, 0, "al responder, el diálogo se va");
prueba("pulsar un botón responde y cierra");

// Enter responde que sí esté donde esté el foco dentro del diálogo: por eso el
// oyente vive en el panel y no en cada botón. Se pulsa sobre el mensaje, que no
// es enfocable, para comprobar justo eso.
respuesta = confirmDialog("Cerrar", "¿Seguro?", OPCIONES);
await esperar();
document.querySelector(".dialog-message").dispatchEvent(evento("keydown", { key: "Enter" }));
assert.equal(await respuesta, "save");
prueba("Enter responde que sí desde cualquier parte del diálogo");

// --- Escape y la pila -------------------------------------------------------

respuesta = confirmDialog("Cerrar", "¿Seguro?", OPCIONES);
await esperar();
teclear("Escape");
assert.equal(await respuesta, "cancel");
prueba("Escape responde lo que cancela");

// Sin salida de cancelar no hay forma de descartarlo: la pregunta tiene que
// responderse. Si Escape cerrara igual, la promesa se quedaría sin resolver.
let resuelta = false;
const obligada = confirmDialog("Sin salida", "Elige.", [
  { label: "Uno", value: "uno", primary: true },
  { label: "Dos", value: "dos" },
]);
void obligada.then(() => (resuelta = true));
await esperar();
teclear("Escape");
await esperar();
assert.equal(resuelta, false, "no se cierra");
assert.equal(dialogos().length, 1);
document.querySelector(".dialog-button").dispatchEvent(evento("click"));
assert.equal(await obligada, "uno");
prueba("sin cancelar, Escape no descarta la pregunta");

// Dos diálogos apilados: Escape es del de arriba y sólo del de arriba.
vaciarLaPila();
const abajo = confirmDialog("Abajo", "El primero.", OPCIONES);
await esperar();
const arriba = confirmDialog("Arriba", "El segundo.", OPCIONES);
await esperar();
assert.equal(dialogos().length, 2);

teclear("Escape");
assert.equal(await arriba, "cancel");
await esperar();
assert.equal(dialogos().length, 1, "el de abajo sigue ahí");
assert.equal(document.querySelector(".dialog-title").textContent, "Abajo");
prueba("Escape cierra el de arriba y deja el de abajo");

teclear("Escape");
assert.equal(await abajo, "cancel");
await esperar();
assert.equal(dialogos().length, 0);
prueba("y después le toca al de abajo");

// --- El fondo ---------------------------------------------------------------

const fondo = document.querySelector("#test-background");

respuesta = confirmDialog("Aislar", "¿Seguro?", OPCIONES);
await esperar();
assert.ok(fondo.inert, "lo de detrás sale del recorrido del teclado");
teclear("Escape");
await respuesta;
await esperar();
assert.ok(!fondo.inert, "y vuelve al cerrarse");
prueba("el fondo se aísla mientras dura y se suelta al cerrar");

// Pulsar el fondo desnudo cancela; pulsar dentro del panel, no.
respuesta = confirmDialog("Fuera", "¿Seguro?", OPCIONES);
await esperar();
document.querySelector(".dialog-message").dispatchEvent(evento("mousedown"));
await esperar();
assert.equal(dialogos().length, 1, "pulsar dentro no cierra");
const backdrop = document.querySelector(".dialog-backdrop");
backdrop.dispatchEvent(evento("mousedown", { target: backdrop }));
assert.equal(await respuesta, "cancel");
prueba("pulsar el fondo cancela, pulsar el panel no");

// --- Sin restos -------------------------------------------------------------

// Lo que de verdad se comprueba: que al cerrar no quede un oyente escuchando.
// Si quedara, este Escape resolvería algo que ya no existe o tocaría el DOM.
await esperar();
assert.equal(dialogos().length, 0);
assert.equal(document.querySelectorAll(".dialog-host").length, 0, "ni el hueco");
teclear("Escape");
teclear("Enter");
await esperar();
assert.equal(dialogos().length, 0, "cerrado es cerrado");
prueba("al cerrar no queda nada escuchando");

console.log(`${hechas} de ${hechas} pruebas de los diálogos correctas`);
