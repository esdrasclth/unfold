/**
 * Pruebas de la barra de estado y del aviso del documento.
 *
 * El recuento se calculaba en `main.ts` y se escribía a mano en tres `span`,
 * lejos de donde se enseña. Al traerlo al componente pasa a poder comprobarse,
 * que es lo que faltaba: un recuento equivocado no se nota mirándolo.
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
const { StatusBar, contarPalabras, minutosDeLectura } = await compilarComponente(
  "../src/components/status/StatusBar.tsx",
);
const { Notice } = await compilarComponente("../src/components/status/Notice.tsx");

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

// --- El recuento ------------------------------------------------------------

assert.equal(contarPalabras(""), 0);
assert.equal(contarPalabras("   \n  "), 0, "sólo espacios no son palabras");
assert.equal(contarPalabras("una"), 1);
assert.equal(contarPalabras("una  dos\ntres\t cuatro"), 4, "cualquier espacio separa");
prueba("las palabras se cuentan como se leen");

// Nunca cero: «0 min de lectura» no dice nada, y un documento de una línea
// sigue costando un momento.
assert.equal(minutosDeLectura(0), 1);
assert.equal(minutosDeLectura(1), 1);
assert.equal(minutosDeLectura(200), 1);
assert.equal(minutosDeLectura(500), 3);
prueba("el tiempo de lectura nunca baja de un minuto");

// --- Lo que se enseña -------------------------------------------------------

const pie = document.createElement("footer");
document.body.append(pie);
const pintarPie = (props) => render(StatusBar(props), pie);
const textos = () => [...pie.querySelectorAll("span")].map((s) => s.textContent.replace(/\s+/g, " "));

pintarPie({ doc: "una dos tres", line: 4, column: 9 });
assert.deepEqual(textos(), ["3 palabras", "12 caracteres", "1 min de lectura", "Ln 4, Col 9"]);
prueba("se enseñan recuento y posición");

// El singular importa: «1 palabras» canta, y es lo que sale de concatenar sin
// mirar.
pintarPie({ doc: "sola", line: 1, column: 1 });
assert.ok(textos()[0] === "1 palabra", textos()[0]);
prueba("una palabra va en singular");

// Separador español y no el inglés: 15.000, no 15,000. Cuatro cifras no se
// agrupan en español, así que la prueba usa cinco.
pintarPie({ doc: "x ".repeat(15_000), line: 1, column: 1 });
assert.match(textos()[0], /^15\.000 palabras$/);
assert.match(textos()[1], /^30\.000 caracteres$/);
prueba("los miles se separan a la española");

pintarPie({ doc: "", line: 1, column: 1 });
assert.deepEqual(textos(), ["0 palabras", "0 caracteres", "1 min de lectura", "Ln 1, Col 1"]);
prueba("un documento vacío no rompe nada");

// La posición se dice entera para quien no ve la abreviatura.
assert.equal(
  pie.querySelector("#stat-caret").getAttribute("aria-label"),
  "Línea 1, columna 1",
);
prueba("la posición se lee entera");

// --- El aviso ---------------------------------------------------------------

const cabecera = document.createElement("div");
document.body.append(cabecera);
const pintarAviso = (props) => render(Notice(props), cabecera);
const marca = () => cabecera.querySelector("#doc-status");

pintarAviso({ notice: null, dirty: true, saved: true });
assert.equal(marca().textContent, "sin guardar");
assert.ok(marca().className.includes("is-dirty"));
assert.equal(marca().getAttribute("aria-label"), "Documento sin guardar");
prueba("un documento con cambios lo dice");

pintarAviso({ notice: null, dirty: false, saved: true });
assert.equal(marca().textContent, "guardado");
assert.ok(!marca().className.includes("is-dirty"));
prueba("y guardado, también");

// Un documento nuevo y sin tocar no es nada todavía: decir «guardado» sería
// mentir, porque no hay archivo donde se haya guardado.
pintarAviso({ notice: null, dirty: false, saved: false });
assert.equal(marca().textContent, "");
prueba("un documento que aún no existe no dice nada");

// El aviso tapa al estado mientras dura, sin perderlo: al irse vuelve el de
// debajo, y no hay que recalcularlo.
pintarAviso({ notice: "Carpeta de copias guardada", dirty: true, saved: true });
assert.equal(marca().textContent, "Carpeta de copias guardada");
assert.ok(marca().className.includes("is-notice"));
assert.ok(!marca().className.includes("is-dirty"), "el aviso manda mientras está");
assert.equal(marca().getAttribute("aria-label"), "Carpeta de copias guardada");
prueba("el aviso tapa al estado");

pintarAviso({ notice: null, dirty: true, saved: true });
assert.equal(marca().textContent, "sin guardar");
assert.ok(marca().className.includes("is-dirty"));
prueba("y al irse vuelve lo que había");

// La clase base no se puede perder: se la lleva todo el aspecto.
assert.ok(marca().className.startsWith("titlebar-status"));
assert.equal(marca().getAttribute("aria-live"), "polite");
prueba("conserva su clase y se anuncia sin interrumpir");

console.log(`${hechas} de ${hechas} pruebas de la barra de estado correctas`);
