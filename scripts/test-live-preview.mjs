/**
 * Pruebas de la vista previa en vivo, que es el corazón del editor.
 *
 * `buildDecorations` toma el estado y los rangos visibles, así que se puede
 * ejercitar sin montar un editor ni un DOM: se construye un `EditorState`, se
 * fuerza el análisis sintáctico y se mira qué decoraciones salen.
 *
 * Lo que se comprueba es la promesa del módulo, no su implementación: que los
 * marcadores se ocultan mientras el cursor está fuera, que reaparecen al
 * entrar en la línea, que una almohadilla dentro de un bloque de código no es
 * un encabezado, y que sólo se decora lo que se ve.
 */
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { buildDecorations } from "../src/editor/livePreview.ts";

/** Estado listo para decorar: con Markdown, cursor donde se pida y ya analizado. */
function estado(doc, cursor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    // La misma base que monta la aplicación. Con `markdown()` a secas, `[x]`
    // se parsea como un enlace y las tareas no existen: se estaría probando
    // otro editor.
    extensions: [markdown({ base: markdownLanguage, addKeymap: false })],
  });
  // Sin esto el árbol llega vacío: el análisis es perezoso y lo dispara la
  // vista, que aquí no existe.
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

/** Todas las decoraciones del documento entero, como lista manejable. */
function decoraciones(doc, cursor, visibles) {
  const state = estado(doc, cursor);
  const { all } = buildDecorations(state, visibles ?? [{ from: 0, to: doc.length }]);
  const salida = [];
  all.between(0, doc.length, (from, to, value) => {
    salida.push({
      from,
      to,
      texto: doc.slice(from, to),
      clase: value.spec.class ?? null,
      // `Decoration.replace` es lo que oculta: no pinta nada en su sitio.
      oculta: value.spec.class === undefined && !value.spec.widget,
      widget: value.spec.widget?.constructor.name ?? null,
    });
  });
  return salida;
}

const oculto = (lista, texto) => lista.some((d) => d.oculta && d.texto === texto);
const conClase = (lista, texto, clase) =>
  lista.some((d) => d.texto === texto && d.clase === clase);

// ── Los marcadores se esconden cuando el cursor no está en la línea ────────
{
  const doc = "# Título\n\nUn párrafo cualquiera.\n";
  const fuera = decoraciones(doc, doc.length);
  assert.ok(oculto(fuera, "# "), "el marcador del encabezado se oculta");
}

// ── …y reaparecen, atenuados, en cuanto la selección toca la línea ─────────
{
  const doc = "# Título\n\nUn párrafo cualquiera.\n";
  const dentro = decoraciones(doc, 3);
  assert.ok(!oculto(dentro, "# "), "con el cursor dentro, el marcador no se oculta");
  // Se revela la almohadilla, no el espacio que la separa del texto: ése ya
  // era texto normal y no hay nada que atenuar en él.
  assert.ok(
    conClase(dentro, "#", "cm-md-revealed"),
    "reaparece marcado como sintaxis revelada, no a pleno contraste",
  );
}

// ── Negrita, cursiva, tachado y código llevan su marca ─────────────────────
{
  const doc = "Esto es **fuerte**, esto *suave*, esto ~~ido~~ y esto `código`.\n";
  const lista = decoraciones(doc, doc.length);
  assert.ok(conClase(lista, "**fuerte**", "cm-md-strong"), "la negrita se marca");
  assert.ok(conClase(lista, "*suave*", "cm-md-em"), "la cursiva se marca");
  assert.ok(conClase(lista, "`código`", "cm-md-code"), "el código en línea se marca");
  // La marca cubre el elemento entero y los delimitadores se ocultan aparte:
  // así el estilo llega al texto sin que se vean los asteriscos.
  assert.ok(oculto(lista, "**"), "y sus delimitadores se esconden");
  assert.ok(oculto(lista, "`"), "también los del código");
}

// ── Una almohadilla dentro de un bloque de código no es un encabezado ──────
{
  const doc = "```bash\n# esto es un comentario\necho hola\n```\n";
  const lista = decoraciones(doc, doc.length);
  assert.ok(
    !oculto(lista, "# "),
    "dentro de un bloque de código la almohadilla es texto, no sintaxis",
  );
}

// ── El frontmatter se trata aparte de las reglas horizontales ──────────────
{
  const doc = "---\ntitulo: Prueba\n---\n\n# Después\n";
  const lista = decoraciones(doc, doc.length);
  // La primera raya no puede acabar convertida en una regla horizontal: para
  // Markdown el frontmatter no existe, y ése es justo el caso raro.
  assert.ok(
    !lista.some((d) => d.widget === "RuleWidget" && d.from === 0),
    "la raya de apertura del frontmatter no es una regla horizontal",
  );
  assert.ok(
    lista.some((d) => d.clase === "cm-md-frontmatter"),
    "se marca como ficha, que es lo que es",
  );
}

// ── Sólo se decora lo que se ve ────────────────────────────────────────────
{
  const doc = "# Uno\n\n## Dos\n\n### Tres\n";
  const tercero = doc.indexOf("### Tres");
  const lista = decoraciones(doc, doc.length, [{ from: tercero, to: doc.length }]);
  assert.ok(oculto(lista, "### "), "lo visible sí se decora");
  assert.ok(
    lista.every((d) => d.from >= tercero),
    "y nada de fuera del rango visible llega a decorarse",
  );
}

// ── Las tareas se dibujan como casilla, y su marcador desaparece ───────────
{
  const doc = "- [x] Hecho\n- [ ] Pendiente\n";
  const lista = decoraciones(doc, doc.length);
  assert.ok(
    lista.some((d) => d.widget === "TaskWidget"),
    "una tarea se sustituye por su casilla",
  );
}

console.log("14 de 14 pruebas de vista previa en vivo correctas");
