import assert from "node:assert/strict";
import { crearDom, evento } from "./dom-preact.mjs";
import { registerCommands } from "../src/app/commands.ts";

/**
 * Los atajos globales.
 *
 * No tenían pruebas, y por ahí se coló que `Ctrl+,` quedara cableado a
 * `closeSettings`: el único atajo que abre la apariencia dejó de abrirla, y
 * sólo se notaba usándolo. Lo que se comprueba aquí es qué manejador recibe
 * cada tecla, que es justo lo que se equivocó.
 */
crearDom();

let hechas = 0;
const check = (actual, esperado, mensaje) => {
  hechas += 1;
  assert.deepEqual(actual, esperado, mensaje);
};

function arnes() {
  const llamadas = [];
  const anotar = (nombre) => (...args) =>
    llamadas.push(args.length ? `${nombre}:${args.join(",")}` : nombre);
  const handlers = {};
  for (const nombre of [
    "closeSettings", "toggleSettings", "zoom", "toggleRepositories", "toggleOutline",
    "open", "create", "close", "cycle", "save", "export", "print", "github",
    "focus", "typewriter", "source", "search", "publish", "palette",
  ]) {
    handlers[nombre] = anotar(nombre);
  }
  const desregistrar = registerCommands(handlers);
  return {
    llamadas,
    desregistrar,
    pulsar(key, campos = {}) {
      // Un evento real siempre trae los modificadores como booleanos; sin
      // ellos, `save(event.shiftKey)` recibiría `undefined` y la prueba estaría
      // comprobando algo que en un navegador no ocurre.
      globalThis.window.dispatchEvent(
        evento("keydown", { key, ctrlKey: true, shiftKey: false, altKey: false, ...campos }),
      );
    },
  };
}

// --- Apariencia --------------------------------------------------------------

{
  const { llamadas, pulsar, desregistrar } = arnes();

  pulsar(",");
  check(llamadas, ["toggleSettings"], "Ctrl+, alterna la apariencia, no la cierra");

  pulsar(",");
  check(
    llamadas,
    ["toggleSettings", "toggleSettings"],
    "Ctrl+, repetido sigue alternando: si sólo cerrara, no habría forma de abrirla con el teclado",
  );

  // Escape sí es sólo cerrar: nunca debe abrir un panel que estaba guardado.
  globalThis.window.dispatchEvent(evento("keydown", { key: "Escape", ctrlKey: false, shiftKey: false, altKey: false }));
  check(
    llamadas,
    ["toggleSettings", "toggleSettings", "closeSettings"],
    "Escape cierra y nada más",
  );

  desregistrar();
}

// --- Que cada tecla siga llamando a lo suyo ----------------------------------

{
  const { llamadas, pulsar, desregistrar } = arnes();
  const casos = [
    [["p", { shiftKey: true }], "palette"],
    [["+"], "zoom:1"],
    [["-"], "zoom:-1"],
    [["b", { shiftKey: true }], "toggleRepositories"],
    [["o", { shiftKey: true }], "toggleOutline"],
    [["o"], "open"],
    [["n"], "create"],
    [["w"], "close"],
    [["Tab"], "cycle:1"],
    [["Tab", { shiftKey: true }], "cycle:-1"],
    [["s"], "save:false"],
    [["s", { shiftKey: true }], "save:true"],
    [["e", { shiftKey: true }], "export"],
    [["p"], "print"],
    [["h", { shiftKey: true }], "github"],
    [["f", { shiftKey: true }], "focus"],
    [["t", { shiftKey: true }], "typewriter"],
    [["m", { shiftKey: true }], "source"],
    [["l", { shiftKey: true }], "search"],
    [["u", { shiftKey: true }], "publish"],
  ];

  for (const [[key, campos], esperado] of casos) {
    llamadas.length = 0;
    pulsar(key, campos);
    check(llamadas, [esperado], `Ctrl+${campos?.shiftKey ? "Shift+" : ""}${key}`);
  }

  // AltGr llega como Ctrl+Alt en algunos teclados: escribir un símbolo no puede
  // convertirse en zoom.
  llamadas.length = 0;
  pulsar("+", { altKey: true });
  check(llamadas, [], "Ctrl+Alt++ no hace zoom");

  // Sin Ctrl no hay atajo que valga: se escribe con normalidad.
  llamadas.length = 0;
  globalThis.window.dispatchEvent(evento("keydown", { key: ",", ctrlKey: false, shiftKey: false, altKey: false }));
  check(llamadas, [], "una coma suelta se escribe, no abre la apariencia");

  desregistrar();
}

// --- Soltar los oyentes ------------------------------------------------------

{
  const { llamadas, pulsar, desregistrar } = arnes();
  desregistrar();
  pulsar(",");
  check(llamadas, [], "tras desregistrar no queda ningún oyente puesto");
}

console.log(`${hechas} de ${hechas} pruebas de atajos correctas`);
