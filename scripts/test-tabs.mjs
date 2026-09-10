import assert from "node:assert/strict";
import { Tabs } from "../src/tabs.ts";

function state(content, anchor = 0, head = anchor) {
  return {
    doc: { length: content.length, toString: () => content },
    selection: { main: { anchor, head } },
    update(spec) {
      return { state: state(content, spec.selection.anchor, spec.selection.head) };
    },
  };
}

function view(content = "") {
  return {
    state: state(content),
    scrollDOM: { scrollTop: 0 },
    setState(next) { this.state = next; },
    requestMeasure(measure) { measure.read(); measure.write(); },
  };
}

const settle = () => new Promise((resolve) => queueMicrotask(resolve));
let assertions = 0;
const check = (actual, expected, message) => {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
};

{
  let changes = 0;
  const tabs = new Tabs((doc) => state(doc), () => { changes += 1; });
  const editor = view("borrador");
  const draft = tabs.adopt(editor.state, "Sin título");
  await settle();

  editor.scrollDOM.scrollTop = 37;
  const file = tabs.open(editor, "C:/notas/uno.md", "uno.md", "archivo");
  await settle();
  check(tabs.count(), 2, "abrir añade una pestaña");
  check(draft.state.doc.toString(), "borrador", "el texto anterior queda capturado");
  check(draft.scrollTop, 37, "también queda capturado el scroll");
  check(tabs.active().id, file.id, "el archivo abierto queda activo");

  const same = tabs.open(editor, "C:/notas/uno.md", "otro nombre", "otro texto");
  await settle();
  check(same.id, file.id, "la misma ruta reutiliza la pestaña");
  check(tabs.count(), 2, "la misma ruta no se duplica");
  check(editor.state.doc.toString(), "archivo", "reabrir no pisa el estado abierto");

  tabs.activate(editor, draft.id);
  await settle();
  check(editor.state.doc.toString(), "borrador", "cambiar restaura el documento");
  check(editor.scrollDOM.scrollTop, 37, "cambiar restaura el scroll");

  tabs.cycle(editor, -1);
  await settle();
  check(tabs.active().id, file.id, "el ciclo da la vuelta entre pestañas");
  check(changes >= 3, true, "los cambios notifican a la interfaz");
}

{
  const tabs = new Tabs((doc) => state(doc), () => {});
  const editor = view("primero");
  const first = tabs.adopt(editor.state, "primero.md");
  const second = tabs.open(editor, "C:/segundo.md", "segundo.md", "segundo");
  const third = tabs.open(editor, "C:/tercero.md", "tercero.md", "tercero");

  check(tabs.close(editor, second.id), true, "se puede cerrar una pestaña inactiva");
  check(tabs.active().id, third.id, "cerrar otra pestaña conserva la activa");
  check(tabs.close(editor, third.id), true, "se puede cerrar la pestaña activa");
  check(tabs.active().id, first.id, "al cerrar la última se elige la de la izquierda");
  check(tabs.close(editor, first.id), false, "la última pestaña se vacía, no desaparece");
  check(tabs.count(), 1, "siempre queda un editor");
  check([tabs.active().path, tabs.active().name, tabs.active().dirty], [null, "Sin título", false]);
  check(editor.state.doc.toString(), "", "la última pestaña queda en blanco");
}

{
  const tabs = new Tabs((doc) => state(doc), () => {});
  const editor = view("inicial");
  tabs.adopt(editor.state, "inicial.md");
  tabs.restore(editor, [{
    path: "C:/restaurado.md",
    name: "restaurado.md",
    dirty: true,
    content: "hola",
    anchor: 99,
    head: -4,
    scrollTop: -20,
  }], 20);

  check(editor.state.doc.toString(), "hola", "la sesión restaura el contenido");
  check(editor.state.selection.main, { anchor: 4, head: 0 }, "la selección se limita al documento");
  check(editor.scrollDOM.scrollTop, 0, "el scroll restaurado nunca es negativo");
  const snapshot = tabs.snapshot(editor);
  check(snapshot.active, 0, "el índice activo restaurado queda dentro del rango");
  check(snapshot.tabs[0].dirty, true, "el borrador conserva su marca de cambios");
}

console.log(`${assertions} de ${assertions} pruebas de pestañas correctas`);
