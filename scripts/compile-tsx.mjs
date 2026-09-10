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

export async function compilarComponente(rutaRelativa) {
  const entrada = fileURLToPath(new URL(rutaRelativa, import.meta.url));
  const nombre = entrada.replace(/[^\w]+/g, "_");

  const salida = await build({
    input: { [nombre]: entrada },
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

  const inicial = salida.output.find((trozo) => trozo.type === "chunk" && trozo.isEntry);
  if (!inicial) throw new Error(`No se pudo compilar ${rutaRelativa}`);
  return import(pathToFileURL(fileURLToPath(new URL(inicial.fileName, DESTINO))).href);
}
