/**
 * Pruebas del renderizador de Markdown a HTML que usa la exportación.
 *
 * Uso: node --experimental-strip-types scripts/test-export.mjs
 */
const { markdownToHtml, slugify } = await import("../src/export/markdownToHtml.ts");

let passed = 0;
const failures = [];

function check(name, markdown, expected) {
  const actual = markdownToHtml(markdown);
  if (actual === expected) {
    passed++;
  } else {
    failures.push({ name, expected, actual });
  }
}

check("encabezado con identificador", "# Hola mundo", '<h1 id="hola-mundo">Hola mundo</h1>');

check(
  "acentos en el identificador",
  "## Sección de código",
  '<h2 id="seccion-de-codigo">Sección de código</h2>',
);

check(
  "identificadores repetidos se numeran",
  "# Uno\n\n# Uno",
  '<h1 id="uno">Uno</h1>\n<h1 id="uno-1">Uno</h1>',
);

check(
  "parrafo con formato",
  "Con **negrita**, *cursiva* y ~~tachado~~.",
  "<p>Con <strong>negrita</strong>, <em>cursiva</em> y <del>tachado</del>.</p>",
);

check("codigo en linea", "Usa `let x = 1` ahora", "<p>Usa <code>let x = 1</code> ahora</p>");

check("lista compacta sin parrafos", "- uno\n- dos", "<ul><li>uno</li><li>dos</li></ul>");

check("lista anidada", "- uno\n  - dos", "<ul><li>uno<ul><li>dos</li></ul></li></ul>");

check("lista ordenada con inicio", "3. tres\n4. cuatro", '<ol start="3"><li>tres</li><li>cuatro</li></ol>');

check(
  "lista de tareas",
  "- [x] hecho\n- [ ] pendiente",
  '<ul><li><input type="checkbox" disabled checked> hecho</li><li><input type="checkbox" disabled> pendiente</li></ul>',
);

check("cita", "> una cita", "<blockquote><p>una cita</p></blockquote>");

check("regla", "---", "<hr>");

check(
  "bloque de codigo con lenguaje",
  "```js\nlet a = 1;\n```",
  '<pre><code class="language-js">let a = 1;</code></pre>',
);

check(
  "escapa el HTML dentro del codigo",
  "```html\n<b>x</b>\n```",
  '<pre><code class="language-html">&lt;b&gt;x&lt;/b&gt;</code></pre>',
);

check(
  "enlace con formato dentro",
  "[**fuerte**](https://x.com)",
  '<p><a href="https://x.com"><strong>fuerte</strong></a></p>',
);

check("imagen", "![Un gato](gato.png)", '<p><img src="gato.png" alt="Un gato"></p>');

check(
  "tabla con alineacion",
  "| a | b |\n| :-- | --: |\n| 1 | 2 |",
  '<table><thead><tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr></thead>' +
    '<tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr></tbody></table>',
);

check("escapa los signos peligrosos", "5 < 6 & 7 > 2", "<p>5 &lt; 6 &amp; 7 &gt; 2</p>");

check("caracter escapado", "un \\* asterisco", "<p>un * asterisco</p>");

if (slugify("Cómo empezar") !== "como-empezar") {
  failures.push({
    name: "slugify quita acentos",
    expected: "como-empezar",
    actual: slugify("Cómo empezar"),
  });
} else {
  passed++;
}

console.log(`${passed} de ${passed + failures.length} pruebas de exportación correctas`);
for (const failure of failures) {
  console.log(`\n[FALLA] ${failure.name}`);
  console.log(`  esperado: ${JSON.stringify(failure.expected)}`);
  console.log(`  obtenido: ${JSON.stringify(failure.actual)}`);
}
process.exit(failures.length === 0 ? 0 : 1);
