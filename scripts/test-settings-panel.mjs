/**
 * Pruebas del panel de apariencia.
 *
 * Lo que se comprueba de fondo es que los controles reflejen lo que hay
 * guardado: un panel que enseña 17 px mientras el documento está a 22 no se ve
 * roto, sólo confunde a quien lo mueve.
 */
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const { window } = parseHTML("<!doctype html><html><body></body></html>");
globalThis.window = window;
globalThis.document = window.document;
for (const name of ["Node", "HTMLElement", "Element", "Event"]) globalThis[name] = window[name];
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
const almacen = new Map();
globalThis.localStorage = {
  getItem: (k) => almacen.get(k) ?? null,
  setItem: (k, v) => void almacen.set(k, String(v)),
  removeItem: (k) => void almacen.delete(k),
};

const { render } = await import("preact");
const { compilarComponente } = await import("./compile-tsx.mjs");
const { SettingsPanel, caracteresPorLinea } = await compilarComponente(
  "../src/components/settings/SettingsPanel.tsx",
);
const { DEFAULTS } = await import("../src/settings.ts");

const host = document.createElement("aside");
document.body.append(host);

let cambios = [];
let reinicios = 0;
let cierres = 0;
const acciones = { check: 0, install: 0, resetDismissed: 0 };

const pintar = (settings, pendingVersion = null, conUpdates = true) =>
  render(
    SettingsPanel({
      settings,
      pendingVersion,
      updates: conUpdates
        ? {
            check: () => (acciones.check += 1),
            install: () => (acciones.install += 1),
            resetDismissed: () => (acciones.resetDismissed += 1),
          }
        : undefined,
      onChange: (patch) => cambios.push(patch),
      onReset: () => (reinicios += 1),
      onClose: () => (cierres += 1),
    }),
    host,
  );

const q = (sel) => host.querySelector(sel);
const clic = (el) => el.dispatchEvent(new window.Event("click", { bubbles: true }));
/**
 * Mueve un control y avisa.
 *
 * linkedom deja `value` como sólo lectura en estos elementos, así que se
 * sombrea en la instancia: lo que importa es lo que lea el manejador, que es
 * `event.currentTarget.value`.
 */
const escribir = (el, valor, tipo) => {
  Object.defineProperty(el, "value", { value: String(valor), configurable: true });
  el.dispatchEvent(new window.Event(tipo, { bubbles: true }));
};

let hechas = 0;
const prueba = (nombre) => { hechas += 1; void nombre; };

// --- Los caracteres por línea -----------------------------------------------

// Depende del tamaño y no sólo del ancho: con letra grande caben menos en la
// misma columna, y calcularlo sólo con la medida daba una cifra falsa.
assert.equal(caracteresPorLinea(40, 16), 80);
assert.ok(caracteresPorLinea(40, 22) < caracteresPorLinea(40, 16), "más grande, caben menos");
assert.ok(caracteresPorLinea(50, 16) > caracteresPorLinea(40, 16), "más ancho, caben más");
prueba("los caracteres por línea cuentan el tamaño de letra");

// --- Lo que se enseña -------------------------------------------------------

pintar({ ...DEFAULTS, fontSize: 22, lineHeight: 1.75, measure: 42 });
assert.equal(q("#set-size").value, "22");
assert.equal(q("#set-size").closest(".settings-group").querySelector(".settings-value").textContent, "22 px");
prueba("el control refleja lo guardado");

// Dos decimales siempre: 1.8 y 1.80 son el mismo número pero uno baila al
// arrastrar y el otro no.
assert.equal(
  q("#set-line").closest(".settings-group").querySelector(".settings-value").textContent,
  "1.75",
);
prueba("el interlineado no baila de ancho");

// --- Lo que cambia ----------------------------------------------------------

// `input` y no `change`: el documento tiene que cambiar mientras se arrastra.
cambios = [];
escribir(q("#set-size"), 19, "input");
assert.deepEqual(cambios, [{ fontSize: 19 }]);
prueba("arrastrar el tamaño avisa en cada paso");

cambios = [];
escribir(q("#set-body-font"), "", "change");
assert.deepEqual(cambios, [{ bodyFont: "" }], "«la del sistema» es una opción, no la ausencia de una");
prueba("la tipografía del sistema se puede elegir");

// --- El color de las barras -------------------------------------------------

pintar({ ...DEFAULTS });
const grupo = q("#set-chrome");
assert.equal(grupo.getAttribute("role"), "radiogroup");
const marcados = [...grupo.querySelectorAll('[aria-checked="true"]')];
assert.equal(marcados.length, 1, "sólo uno puede estar elegido");
prueba("los colores son un grupo de opciones, y sólo una manda");

cambios = [];
const otro = [...grupo.querySelectorAll(".settings-swatch")].find(
  (s) => s.getAttribute("aria-checked") !== "true",
);
clic(otro);
assert.equal(cambios.length, 1);
assert.ok("chrome" in cambios[0]);
prueba("elegir un color lo pide entero");

// --- Actualizaciones --------------------------------------------------------

// Sin versión pendiente la fila no aparece: un botón de instalar algo que no
// existe es peor que no tener botón.
pintar({ ...DEFAULTS }, null);
assert.equal(q(".settings-pending"), null);

pintar({ ...DEFAULTS }, "0.6.0");
assert.equal(q(".settings-pending").textContent.trim(), "Instalar Unfold 0.6.0");
clic(q(".settings-pending"));
assert.equal(acciones.install, 1);
prueba("la versión pendiente sólo aparece cuando la hay");

clic(q("#settings-check-updates"));
assert.equal(acciones.check, 1);
prueba("se puede buscar a mano");

// Sin el bloque de actualizaciones —en el navegador— el panel sigue entero.
pintar({ ...DEFAULTS }, null, false);
assert.equal(q(".settings-updates"), null);
assert.ok(q("#set-size"), "el resto del panel sigue ahí");
prueba("sin actualizador el panel no se rompe");

// --- Cerrar y restablecer ---------------------------------------------------

pintar({ ...DEFAULTS });
clic(q("#settings-reset"));
assert.equal(reinicios, 1);
clic(q("#settings-close"));
assert.equal(cierres, 1);
assert.equal(q("#settings-close").getAttribute("aria-label"), "Cerrar los ajustes");
prueba("restablecer y cerrar responden, y el aspa se nombra");

console.log(`${hechas} de ${hechas} pruebas del panel de apariencia correctas`);
