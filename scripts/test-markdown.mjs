/**
 * Pruebas del conversor de HTML a Markdown.
 *
 * Se ejecuta con un DOM de linkedom en lugar de un navegador, para poder
 * comprobar en segundos lo que de otro modo exigiría compilar la app entera
 * y pegar a mano desde el portapapeles.
 *
 * Uso: node --experimental-strip-types scripts/test-markdown.mjs
 */
import { parseHTML } from "linkedom";

// El DOMParser de linkedom trata el fragmento como documento entero, así que
// lo envolvemos nosotros para obtener el mismo <body> que da un navegador.
globalThis.DOMParser = class {
  parseFromString(html) {
    return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
  }
};

const { markdownFromHtml } = await import("../src/editor/markdownFromHtml.ts");

let passed = 0;
const failures = [];

function check(name, html, expected) {
  const actual = markdownFromHtml(html);
  if (actual === expected) {
    passed++;
  } else {
    failures.push({ name, expected, actual });
  }
}

check("encabezado", "<h2>Un titular</h2>", "## Un titular");

check(
  "parrafo con formato",
  '<p>Texto con <strong>negrita</strong>, <em>cursiva</em> y <a href="https://tauri.app">enlace</a>.</p>',
  "Texto con **negrita**, *cursiva* y [enlace](https://tauri.app).",
);

check("tachado", "<p><del>fuera</del></p>", "~~fuera~~");

check("codigo en linea", "<p>Llama a <code>hazAlgo()</code> ya</p>", "Llama a `hazAlgo()` ya");

check(
  "lista simple",
  "<ul><li>Primero</li><li>Segundo</li></ul>",
  "- Primero\n- Segundo",
);

check(
  "lista anidada",
  "<ul><li>Uno<ul><li>Uno uno</li></ul></li></ul>",
  "- Uno\n  - Uno uno",
);

check(
  "lista ordenada",
  "<ol><li>Uno</li><li>Dos</li></ol>",
  "1. Uno\n2. Dos",
);

check("cita", "<blockquote><p>Una cita.</p></blockquote>", "> Una cita.");

check("regla", "<hr>", "---");

check(
  "bloque de codigo con lenguaje",
  '<pre><code class="language-js">const x = 1;</code></pre>',
  "```js\nconst x = 1;\n```",
);

check(
  "tabla",
  "<table><thead><tr><th>Clave</th><th>Valor</th></tr></thead><tbody><tr><td>uno</td><td>1</td></tr></tbody></table>",
  "| Clave | Valor |\n| --- | --- |\n| uno | 1 |",
);

check(
  "imagen",
  '<p><img src="foto.png" alt="Una foto"></p>',
  "![Una foto](foto.png)",
);

check(
  "escapa sintaxis accidental",
  "<p>Cuesta 5 * 3 euros</p>",
  "Cuesta 5 \\* 3 euros",
);

check(
  "colapsa espacios del HTML",
  "<p>uno    dos\n   tres</p>",
  "uno dos tres",
);

check(
  "documento completo",
  "<h1>Titulo</h1><p>Intro.</p><ul><li>a</li></ul>",
  "# Titulo\n\nIntro.\n\n- a",
);

console.log(`${passed} de ${passed + failures.length} pruebas correctas`);
for (const failure of failures) {
  console.log(`\n[FALLA] ${failure.name}`);
  console.log(`  esperado: ${JSON.stringify(failure.expected)}`);
  console.log(`  obtenido: ${JSON.stringify(failure.actual)}`);
}
process.exit(failures.length === 0 ? 0 : 1);
