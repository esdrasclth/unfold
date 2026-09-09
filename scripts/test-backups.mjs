import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Almacén con la forma de `localStorage`, con cuota opcional. */
function almacenFalso(limite = Infinity) {
  const valores = new Map();
  return {
    valores,
    getItem: (k) => valores.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > limite) throw new Error("QuotaExceededError");
      valores.set(k, v);
    },
    removeItem: (k) => void valores.delete(k),
  };
}

/** Llamadas que el módulo manda a Rust, para poder mirarlas. */
const llamadas = [];
let respuesta = null;
let falla = false;

globalThis.localStorage = almacenFalso();
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: (cmd, args) => {
      llamadas.push({ cmd, args });
      if (falla) return Promise.reject(new Error("el disco dijo que no"));
      return Promise.resolve(respuesta);
    },
  },
};

// Dinámico: `files.ts` mira `window` al cargarse para saber si está bajo Tauri,
// y los `import` estáticos se elevan por encima de las líneas de arriba.
const { backupFolder, createBackup, limpiarIndiceViejo, restoreLatest, setBackupFolder } =
  await import("../src/backups.ts");

// --- La carpeta ------------------------------------------------------------

assert.equal(backupFolder(), null, "sin configurar no hay carpeta");
setBackupFolder("D:/copias");
assert.equal(backupFolder(), "D:/copias");
setBackupFolder(null);
assert.equal(backupFolder(), null, "se puede desconfigurar");
setBackupFolder("D:/copias");

// --- Escribir --------------------------------------------------------------

// Antes la condición estaba al revés (`!content || !isTauri`) y un documento
// vacío escribía «» en `localStorage` incluso con Tauri delante.
await createBackup("C:/notas.md", "");
assert.equal(llamadas.length, 0, "un documento en blanco no se copia");
assert.equal(
  globalThis.localStorage.getItem("unfold:backup:C:/notas.md"),
  null,
  "y tampoco cae en localStorage",
);

await createBackup("C:/notas.md", "# Hola");
assert.deepEqual(llamadas.at(-1), {
  cmd: "backup_write",
  args: { folder: "D:/copias", key: "C:/notas.md", contents: "# Hola" },
});

// Sin carpeta elegida no hay dónde copiar, y preguntar por ello cada treinta
// segundos sería peor que no hacer nada.
setBackupFolder(null);
const antes = llamadas.length;
await createBackup("C:/notas.md", "# Hola");
assert.equal(llamadas.length, antes, "sin carpeta no se llama a Rust");
setBackupFolder("D:/copias");

// Copiar se dispara desde un temporizador: si el fallo saliera hacia arriba
// sería una promesa rechazada sin nadie que la recoja.
falla = true;
const avisoOriginal = console.warn;
let avisos = 0;
console.warn = () => { avisos += 1; };
await createBackup("C:/notas.md", "# Hola");
assert.equal(avisos, 1, "el fallo del disco se avisa, no se propaga");

// --- Restaurar -------------------------------------------------------------

assert.equal(await restoreLatest("C:/notas.md"), null, "un fallo al leer no rompe");
console.warn = avisoOriginal;
falla = false;

respuesta = "# Lo copiado";
assert.equal(await restoreLatest("C:/notas.md"), "# Lo copiado");
assert.deepEqual(llamadas.at(-1).args, { folder: "D:/copias", key: "C:/notas.md" });

respuesta = null;
assert.equal(await restoreLatest("C:/otro.md"), null, "sin copia no es un error");

// --- El índice viejo -------------------------------------------------------

// Quien actualice desde la versión anterior lo trae puesto; ya no lo lee nadie.
globalThis.localStorage.setItem("unfold:backup-index", '[{"key":"x","path":"y"}]');
limpiarIndiceViejo();
assert.equal(globalThis.localStorage.getItem("unfold:backup-index"), null);

// --- Sin Tauri delante -----------------------------------------------------

// `isTauri` se decide al cargar el módulo mirando `window`, así que la rama del
// navegador no cabe en este proceso: se comprueba en otro.
const navegador = `
import assert from "node:assert/strict";
const valores = new Map();
let limite = Infinity;
globalThis.window = {};
globalThis.localStorage = {
  getItem: (k) => valores.get(k) ?? null,
  setItem: (k, v) => { if (v.length > limite) throw new Error("QuotaExceededError"); valores.set(k, v); },
  removeItem: (k) => void valores.delete(k),
};
const { createBackup, restoreLatest } = await import(${JSON.stringify(
  new URL("../src/backups.ts", import.meta.url).href,
)});

await createBackup("notas", "# Hola");
assert.equal(valores.get("unfold:backup:notas"), "# Hola", "una ranura por documento");
assert.equal(await restoreLatest("notas"), "# Hola");

// Esto es lo que reventaba: sin Tauri no hay carpeta, y una cuota llena
// lanzaba desde un temporizador, sin nadie que recogiera el rechazo.
limite = 2;
let avisos = 0;
console.warn = () => { avisos += 1; };
await createBackup("notas", "algo demasiado largo");
assert.equal(avisos, 1, "la cuota llena se avisa en vez de lanzar");
`;

const salida = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--input-type=module", "--eval", navegador],
  { cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8" },
);
assert.equal(salida.status, 0, `la rama del navegador falló:
${salida.stderr}`);

console.log("16 de 16 pruebas de copias de seguridad correctas");
