import { build } from "rolldown";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Compila un componente `.tsx` para poder probarlo en Node.
 *
 * `--experimental-strip-types` quita los tipos pero no traduce JSX, así que los
 * componentes no se pueden importar tal cual desde una prueba. Rolldown ya está
 * aquí —es lo que usa Vite para construir— y aplica la misma configuración de
 * JSX, de modo que lo que se prueba se compila igual que lo que se publica.
 *
 * Preact se deja fuera del paquete a propósito: la prueba tiene que usar el
 * mismo módulo que el resto del proceso o `render` no reconocería nada.
 */
const DESTINO = new URL("../node_modules/.unfold-test/", import.meta.url);

/**
 * Compila varias entradas en un solo paquete y junta lo que exportan.
 *
 * Hace falta cuando dos módulos comparten estado: la pila de diálogos vive en
 * un módulo, y compilarlos por separado daría dos pilas distintas. Con una sola
 * construcción, lo común queda en un trozo compartido y el estado es uno.
 */
export async function compilarJuntos(rutasRelativas) {
  const modulos = await compilarEntradas(rutasRelativas);
  return Object.assign({}, ...modulos);
}

export async function compilarComponente(rutaRelativa) {
  const [modulo] = await compilarEntradas([rutaRelativa]);
  return modulo;
}

async function compilarEntradas(rutasRelativas) {
  const entradas = rutasRelativas.map((ruta) => fileURLToPath(new URL(ruta, import.meta.url)));
  const nombres = entradas.map((entrada) => entrada.replace(/[^\w]+/g, "_"));

  const salida = await build({
    input: Object.fromEntries(nombres.map((nombre, i) => [nombre, entradas[i]])),
    platform: "neutral",
    external: [/^preact/],
    output: {
      format: "esm",
      entryFileNames: "[name].mjs",
      chunkFileNames: "[name]-[hash].mjs",
    },
    write: false,
    logLevel: "silent",
  });

  // A archivos de verdad y dentro del proyecto, no a un `data:`: los módulos de
  // datos no resuelven `preact`, que es un especificador desnudo y necesita un
  // `node_modules` por encima desde el que buscar.
  //
  // Y se escriben todos los trozos, no sólo la entrada: un `import()` diferido
  // —el plugin de archivos que usa el explorador— se queda en un trozo aparte.
  await mkdir(DESTINO, { recursive: true });
  for (const trozo of salida.output) {
    if (trozo.type !== "chunk") continue;
    await writeFile(new URL(trozo.fileName, DESTINO), trozo.code, "utf8");
  }

  return Promise.all(
    nombres.map((nombre, i) => {
      const trozo = salida.output.find(
        (candidato) => candidato.type === "chunk" && candidato.name === nombre,
      );
      if (!trozo) throw new Error(`No se pudo compilar ${rutasRelativas[i]}`);
      return import(pathToFileURL(fileURLToPath(new URL(trozo.fileName, DESTINO))).href);
    }),
  );
}
