/**
 * Pruebas del detector de fórmulas en línea.
 *
 * Es donde más fácil es equivocarse: el delimitador es un solo carácter que
 * también se usa para precios, y un falso positivo desfigura el texto.
 *
 * Uso: node --experimental-strip-types scripts/test-math.mjs
 */
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

const { inlineMath } = await import("../src/editor/inlineMath.ts");

function formulas(texto) {
  const state = EditorState.create({
    doc: texto,
    extensions: [markdown({ base: markdownLanguage })],
  });
  return inlineMath(state, 0, state.doc.length).map((m) => m.tex);
}

let passed = 0;
const failures = [];

function check(name, texto, esperado) {
  const actual = formulas(texto);
  if (JSON.stringify(actual) === JSON.stringify(esperado)) passed++;
  else failures.push({ name, texto, esperado, actual });
}

// Un backslash literal, escrito así para que no dependa de cómo se guarde el
// archivo: escribirlo a mano se ha perdido ya una vez.
const BARRA = String.fromCharCode(92);

check("formula simple", "Sea $x^2$ el area", ["x^2"]);
check("dos formulas", "$a$ y $b$", ["a", "b"]);
check("precios no son formulas", "cuesta $20 y otro de $35 mas", []);
check("precio suelto", "vale $50", []);
check("espacio tras la apertura", "$ x $", []);
check("delimitadores de bloque", "$$", []);
check("dolar escapado", `cuesta ${BARRA}$5 y $y=1$ aqui`, ["y=1"]);
check("cierre escapado", `$a${BARRA}$b$`, [`a${BARRA}$b`]);
check("no cruza lineas", "$a\nb$", []);
check("dentro de codigo en linea", "usa `$x^2$` aqui", []);
check("dentro de bloque de codigo", "```\nconst p = $x$;\n```", []);
check("formula con espacios dentro", "$a + b$ vale", ["a + b"]);
check("contenido vacio", "$$ no", []);
check("dos cantidades pegadas", "$20$35", []);
check("formula tras un precio", "cuesta $20 pero $x=1$ vale", ["x=1"]);

console.log(`${passed} de ${passed + failures.length} pruebas de fórmulas correctas`);
for (const f of failures) {
  console.log(`\n[FALLA] ${f.name}`);
  console.log(`  entrada:  ${JSON.stringify(f.texto)}`);
  console.log(`  esperado: ${JSON.stringify(f.esperado)}`);
  console.log(`  obtenido: ${JSON.stringify(f.actual)}`);
}
process.exit(failures.length === 0 ? 0 : 1);
