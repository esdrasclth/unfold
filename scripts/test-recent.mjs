import assert from "node:assert/strict";

const valores = new Map();
globalThis.localStorage = {
  getItem: (k) => valores.get(k) ?? null,
  setItem: (k, v) => void valores.set(k, v),
  removeItem: (k) => void valores.delete(k),
};

const { folderOf, forgetRecent, loadRecent, rememberRecent, whenLabel } =
  await import("../src/recent.ts");

const CLAVE = "unfold:recent";
let hechas = 0;
const prueba = (nombre, fn) => { valores.clear(); fn(); hechas += 1; void nombre; };

// --- La lista --------------------------------------------------------------

prueba("sin nada guardado la lista está vacía", () => {
  assert.deepEqual(loadRecent(), []);
});

prueba("lo último abierto va primero", () => {
  rememberRecent("C:/a.md", "a");
  rememberRecent("C:/b.md", "b");
  assert.deepEqual(loadRecent().map((r) => r.name), ["b", "a"]);
});

// Reabrir un archivo lo sube al principio; si no, la lista de recientes se
// llenaría de copias del mismo documento y echaría a los demás.
prueba("reabrir mueve al principio en vez de duplicar", () => {
  rememberRecent("C:/a.md", "a");
  rememberRecent("C:/b.md", "b");
  const lista = rememberRecent("C:/a.md", "a");
  assert.deepEqual(lista.map((r) => r.name), ["a", "b"]);
  assert.equal(lista.length, 2, "no hay dos entradas de a.md");
});

prueba("la lista tiene tope y se pierde lo más viejo", () => {
  for (let i = 0; i < 20; i += 1) rememberRecent(`C:/doc${i}.md`, `doc${i}`);
  const lista = loadRecent();
  assert.equal(lista.length, 12);
  assert.equal(lista[0].name, "doc19", "lo más reciente sobrevive");
  assert.ok(!lista.some((r) => r.name === "doc7"), "lo viejo se cae");
});

prueba("olvidar quita sólo esa ruta", () => {
  rememberRecent("C:/a.md", "a");
  rememberRecent("C:/b.md", "b");
  assert.deepEqual(forgetRecent("C:/a.md").map((r) => r.name), ["b"]);
  assert.deepEqual(loadRecent().map((r) => r.name), ["b"], "y queda guardado");
});

// --- Lo que puede venir roto ------------------------------------------------

// El archivo lo puede haber tocado cualquiera, y una lista de recientes ilegible
// no puede impedir que la aplicación arranque.
prueba("un JSON corrupto se lee como lista vacía", () => {
  valores.set(CLAVE, "{ esto no es json");
  assert.deepEqual(loadRecent(), []);
});

prueba("algo que no es una lista se lee como lista vacía", () => {
  valores.set(CLAVE, '{"path":"C:/a.md"}');
  assert.deepEqual(loadRecent(), []);
});

prueba("las entradas sin ruta se descartan", () => {
  valores.set(CLAVE, '[{"path":"C:/a.md","name":"a"},{"name":"sin ruta"},null,{"path":7}]');
  assert.deepEqual(loadRecent().map((r) => r.path), ["C:/a.md"]);
});

// --- La carpeta -------------------------------------------------------------

// Se enseña para distinguir dos `README.md` de proyectos distintos, así que
// tiene que salir la carpeta que los contiene y no la ruta entera.
prueba("la carpeta sale de la ruta, con barras de cualquier tipo", () => {
  assert.equal(folderOf(String.raw`C:\proyectos\unfold\README.md`), "unfold");
  assert.equal(folderOf("/home/ana/notas/diario.md"), "notas");
  assert.equal(folderOf("suelto.md"), "", "sin carpeta no se inventa una");
});

// --- El «cuándo» ------------------------------------------------------------

prueba("el momento se cuenta en la unidad que toca", () => {
  const hace = (ms) => whenLabel(Date.now() - ms);
  const MIN = 60_000;
  assert.equal(hace(0), "hace un momento");
  assert.equal(hace(30_000), "hace un momento");
  assert.equal(hace(5 * MIN), "hace 5 min");
  assert.equal(hace(59 * MIN), "hace 59 min");
  assert.equal(hace(3 * 60 * MIN), "hace 3 h");
  assert.equal(hace(3 * 24 * 60 * MIN), "hace 3 d");
});

// Pasada una semana la cuenta atrás deja de decir nada útil: «hace 43 d» no
// sitúa a nadie, y una fecha sí.
prueba("pasada una semana se enseña la fecha", () => {
  const etiqueta = whenLabel(new Date(2026, 2, 12).getTime());
  assert.ok(/12/.test(etiqueta) && /mar/i.test(etiqueta), `esperaba una fecha: ${etiqueta}`);
  assert.ok(!etiqueta.startsWith("hace"), etiqueta);
});

console.log(`${hechas} de ${hechas} pruebas de documentos recientes correctas`);
