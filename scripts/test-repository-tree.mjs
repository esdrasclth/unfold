/**
 * Pruebas del explorador migrado.
 *
 * Se prueba por separado lo que antes estaba junto: el árbol y los resúmenes
 * son funciones puras, y la vista es un componente que recibe datos ya leídos.
 * Nada de esto llama al backend, que es justo lo que se quiere garantizar.
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
const { buildTree, summaryOf, fold, nameOf, folderOf, samePath } = await compilarComponente(
  "../src/components/repositories/tree.ts",
);
const { RepositoryTree } = await compilarComponente(
  "../src/components/repositories/RepositoryTree.tsx",
);
const { textoDeCuenta, diasHastaCaducar } = await compilarComponente(
  "../src/components/repositories/RepositoryFooter.tsx",
);

let hechas = 0;
const prueba = (nombre) => {
  hechas += 1;
  void nombre;
};

const doc = (relative, state = "synced") => ({
  relative,
  path: `C:/repo/${relative}`,
  state,
});

// --- El árbol ---------------------------------------------------------------

const arbol = buildTree([doc("README.md"), doc("docs/guia.md"), doc("docs/api/rest.md")]);
assert.deepEqual(arbol.documents.map((d) => d.relative), ["README.md"]);
assert.deepEqual([...arbol.folders.keys()], ["docs"]);
assert.deepEqual([...arbol.folders.get("docs").folders.keys()], ["api"]);
assert.deepEqual(arbol.folders.get("docs").documents.map((d) => d.relative), ["docs/guia.md"]);
prueba("las rutas planas se agrupan en carpetas");

// La ruta acumulada es la clave con la que se recuerda qué está plegado: si se
// pierde, plegar una carpeta plegaría también su homónima de otro nivel.
assert.equal(arbol.folders.get("docs").folders.get("api").path, "docs/api");
prueba("cada carpeta sabe su ruta entera");

assert.equal(nameOf("docs/api/rest.md"), "rest.md");
assert.equal(folderOf("docs/api/rest.md"), "docs/api");
assert.equal(folderOf("README.md"), "", "en la raíz no hay carpeta que decir");
prueba("nombre y carpeta se sacan de la ruta");

// --- El resumen -------------------------------------------------------------

const repo = (extra) => ({
  id: 7,
  fullName: "unfold/notas",
  path: "C:/repo",
  defaultBranch: "main",
  branch: "main",
  hasUpstream: true,
  canPush: true,
  changed: 0,
  ahead: 0,
  behind: 0,
  missing: false,
  ...extra,
});

assert.equal(summaryOf(repo()), "main · sincronizado");
assert.equal(summaryOf(repo({ changed: 3 })), "main · 3 sin confirmar");
assert.equal(
  summaryOf(repo({ changed: 2, ahead: 1, behind: 4 })),
  "main · 2 sin confirmar · 1 sin publicar · 4 sin traer",
);
assert.equal(summaryOf(repo({ missing: true })), "Sin copia local");
prueba("el resumen dice lo que hay pendiente");

// Sin remoto conocido no se puede afirmar que esté sincronizado, sólo que no
// hay nada pendiente por aquí.
assert.equal(summaryOf(repo({ hasUpstream: false })), "main · sin remoto");
prueba("sin remoto no se promete sincronía");

// Una carpeta local enseña dónde está: no tiene rama ni nada que publicar.
assert.equal(summaryOf(repo({ id: -5, path: "D:/apuntes" })), "D:/apuntes");
assert.equal(summaryOf(repo({ id: -5, missing: true })), "La carpeta ya no está");
prueba("una carpeta local dice su ruta");

// --- El filtro --------------------------------------------------------------

// Se escribe sin tildes más veces de las que se admite.
assert.equal(fold("Guía DE Estilo"), "guia de estilo");
prueba("el filtro ignora tildes y mayúsculas");

assert.ok(samePath("C:\\repo\\a.md", "C:/repo/a.md"), "las barras de Windows no hacen otra ruta");
assert.ok(!samePath(null, "C:/a.md"));
prueba("dos rutas son la misma aunque cambien las barras");

// --- La vista ---------------------------------------------------------------

const host = document.createElement("div");
document.body.append(host);

const REPOS = [repo(), repo({ id: 8, fullName: "unfold/web", ahead: 2 })];
const DOCS = new Map([
  [7, [doc("README.md"), doc("docs/guia.md", "modified")]],
  [8, [doc("index.md")]],
]);

let abiertos = [];
const base = {
  repositories: REPOS,
  documents: DOCS,
  loading: false,
  problem: null,
  query: "",
  activePath: null,
  collapsedRepos: new Set(),
  collapsedFolders: new Set(),
  onToggleRepo: () => {},
  onToggleFolder: () => {},
  onOpen: (r, d) => abiertos.push(d.relative),
  onCreate: () => {},
  onPublish: () => {},
  onCloseFolder: () => {},
};
const pintar = (extra) => render(RepositoryTree({ ...base, ...extra }), host);
const textos = (sel) => [...host.querySelectorAll(sel)].map((n) => n.textContent);

pintar({});
assert.deepEqual(textos(".repo-name"), ["unfold/notas", "unfold/web"]);
// Las carpetas van antes que los documentos sueltos, así que `guia.md` —que
// vive en `docs/`— sale por encima del `README.md` de la raíz.
assert.deepEqual(textos(".repos-document-name"), ["guia.md", "README.md", "index.md"]);
prueba("se pintan los repositorios con su árbol");

// El estado del documento va en la clase: es el punto de color que dice que
// algo está sin confirmar sin tener que abrirlo.
assert.ok(
  [...host.querySelectorAll(".repos-document")].some((d) => d.className.includes("is-modified")),
);
prueba("los documentos con cambios se distinguen");

// Publicar sólo aparece cuando hay algo que publicar, y dice cuál de los dos
// trabajos es: elegir y describir, o sólo subir.
pintar({ repositories: [repo({ changed: 3 })] });
assert.equal(host.querySelector(".repos-publish").textContent, "Publicar cambios (3)");
pintar({ repositories: [repo({ ahead: 1 })] });
assert.equal(host.querySelector(".repos-publish").textContent, "Publicar 1 commit pendiente");
pintar({ repositories: [repo({ ahead: 4 })] });
assert.equal(host.querySelector(".repos-publish").textContent, "Publicar 4 commits pendientes");
pintar({ repositories: [repo()] });
assert.equal(host.querySelector(".repos-publish"), null, "sin nada pendiente no hay botón");
pintar({ repositories: [repo({ changed: 3, canPush: false })] });
assert.equal(host.querySelector(".repos-publish"), null, "sin permiso tampoco");
prueba("publicar aparece sólo cuando hay algo que publicar");

// --- Plegar -----------------------------------------------------------------

pintar({ collapsedRepos: new Set([7]) });
assert.equal(host.querySelectorAll(".repos-document").length, 1, "sólo quedan los del otro");
assert.equal(host.querySelector(".repo-toggle").getAttribute("aria-expanded"), "false");
prueba("un repositorio plegado esconde su árbol");

pintar({ collapsedFolders: new Set(["7:docs"]) });
assert.deepEqual(textos(".repos-document-name"), ["README.md", "index.md"]);
prueba("una carpeta plegada esconde lo suyo");

// --- Buscar -----------------------------------------------------------------

// Plana a propósito: cuando ya se sabe el nombre, lo que se quiere es la lista.
pintar({ query: "guia" });
assert.deepEqual(textos(".repos-document-name"), ["guia.md"]);
assert.equal(host.querySelectorAll(".repos-folder").length, 0, "sin jerarquía que recorrer");
assert.equal(host.querySelector(".repos-document-folder").textContent, "docs", "pero dice dónde está");
prueba("buscar da una lista plana con la carpeta al lado");

pintar({ query: "nada-de-esto" });
assert.match(host.querySelector(".repos-empty").textContent, /Ningún documento coincide/);
prueba("sin coincidencias se dice");

// --- Estados vacíos ---------------------------------------------------------

pintar({ repositories: [], loading: true });
assert.equal(host.querySelector(".repos-empty").textContent, "Leyendo repositorios…");
pintar({ repositories: [], loading: false });
assert.match(host.querySelector(".repos-empty").textContent, /No hay repositorios conectados/);
pintar({ problem: "El disco no responde" });
assert.equal(host.querySelector(".repos-empty").textContent, "El disco no responde");
prueba("leyendo, vacío y averiado se distinguen");

// Un repositorio sin copia local no puede parecer un repositorio vacío.
pintar({ repositories: [repo({ missing: true })], documents: new Map() });
assert.match(host.querySelector(".repos-empty").textContent, /ya no está en el disco/);
prueba("un repositorio sin copia lo dice");

// --- Abrir ------------------------------------------------------------------

abiertos = [];
pintar({});
// El primero del DOM es el de dentro de `docs/`, por el mismo orden de antes.
host.querySelector(".repos-document").dispatchEvent(new window.Event("click", { bubbles: true }));
assert.deepEqual(abiertos, ["docs/guia.md"]);
prueba("pulsar un documento lo abre");

// El documento en pantalla se marca, y se anuncia.
pintar({ activePath: "C:\\repo\\README.md" });
const activo = host.querySelector(".repos-document.is-active");
assert.ok(activo, "las barras de Windows no pueden impedir reconocerlo");
assert.equal(activo.getAttribute("aria-current"), "true");
prueba("el documento abierto se marca");

// --- El pie -----------------------------------------------------------------

assert.equal(textoDeCuenta("ada", 0, null), "@ada · sin repositorios");
assert.equal(textoDeCuenta("ada", 1, null), "@ada · 1 repositorio");
assert.equal(textoDeCuenta("ada", 4, null), "@ada · 4 repositorios");
prueba("el pie cuenta los repositorios en singular y plural");

// El aviso sustituye a la línea en vez de añadir otra: el pie no puede crecer.
assert.equal(textoDeCuenta("ada", 4, 3), "La sesión caduca en 3 días");
assert.equal(textoDeCuenta("ada", 4, 1), "La sesión caduca mañana");
assert.equal(textoDeCuenta("ada", 4, 0), "La sesión ha caducado: vuelve a conectar");
assert.equal(textoDeCuenta("ada", 4, 120), "@ada · 4 repositorios", "faltando meses no se avisa");
prueba("la caducidad manda sobre el recuento, y sólo cuando toca");

assert.equal(diasHastaCaducar(null), null, "sin fecha no hay cuenta atrás");
prueba("sin fecha de caducidad no se inventa una");

console.log(`${hechas} de ${hechas} pruebas del explorador correctas`);
