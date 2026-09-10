import { parseHTML } from "linkedom";

/**
 * Un DOM de mentira donde Preact se comporta como en un navegador.
 *
 * linkedom llama a cada oyente con `this` ligado al elemento que originó el
 * evento en vez de a aquel donde está el oyente. Preact usa `this` para
 * encontrar el manejador —guarda los suyos en el propio nodo—, así que
 * cualquier evento que burbujee revienta con «t is not a function», y los
 * manejadores puestos en un contenedor no llegan a enterarse.
 *
 * Eso hace imposible probar nada delegado: el Enter del panel de un diálogo,
 * el clic en el fondo, un teclado puesto en una lista. Se envuelve cada oyente
 * para que reciba el `this` que le tocaría, y se recuerda el envoltorio para
 * poder quitarlo después: si `removeEventListener` no encontrara el mismo, los
 * oyentes se quedarían puestos y las pruebas de limpieza mentirían.
 *
 * También se apuntan `inert` y el foco, que linkedom no trae y son justo lo que
 * hay que mirar en un modal.
 */
export function crearDom(html = "<!doctype html><html><body></body></html>") {
  const { window } = parseHTML(html);
  globalThis.window = window;
  globalThis.document = window.document;
  for (const nombre of ["Node", "HTMLElement", "Element", "Event"]) {
    globalThis[nombre] = window[nombre];
  }
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);

  const envoltorios = new WeakMap();
  const anadir = window.EventTarget.prototype.addEventListener;
  const quitar = window.EventTarget.prototype.removeEventListener;

  window.EventTarget.prototype.addEventListener = function (tipo, manejador, opciones) {
    if (typeof manejador !== "function") return anadir.call(this, tipo, manejador, opciones);
    let porNodo = envoltorios.get(manejador);
    if (!porNodo) {
      porNodo = new WeakMap();
      envoltorios.set(manejador, porNodo);
    }
    let envuelto = porNodo.get(this);
    if (!envuelto) {
      envuelto = function (evento) {
        return manejador.call(evento.currentTarget ?? this, evento);
      };
      porNodo.set(this, envuelto);
    }
    return anadir.call(this, tipo, envuelto, opciones);
  };

  window.EventTarget.prototype.removeEventListener = function (tipo, manejador, opciones) {
    const envuelto = envoltorios.get(manejador)?.get(this) ?? manejador;
    return quitar.call(this, tipo, envuelto, opciones);
  };

  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    get() {
      return this.hasAttribute("inert");
    },
    set(valor) {
      if (valor) this.setAttribute("inert", "");
      else this.removeAttribute("inert");
    },
    configurable: true,
  });

  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.focus = function focus() {
    Object.defineProperty(document, "activeElement", { value: this, configurable: true });
  };

  return window;
}

/** Un evento con los campos que miran los componentes. */
export function evento(tipo, campos = {}) {
  return Object.assign(new globalThis.window.Event(tipo, { bubbles: true }), {
    preventDefault: () => {},
    stopPropagation: () => {},
    ...campos,
  });
}
