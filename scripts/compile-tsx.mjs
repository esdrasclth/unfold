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
  const salida = await build({
    input: entrada,
    platform: "neutral",
    external: [/^preact/],
    output: { format: "esm" },
    write: false,
    logLevel: "silent",
  });

  const codigo = salida.output.find((chunk) => chunk.type === "chunk")?.code;
  if (!codigo) throw new Error(`No se pudo compilar ${rutaRelativa}`);

  // A un archivo de verdad y dentro del proyecto, no a un `data:`: los módulos
  // de datos no resuelven `preact`, que es un especificador desnudo y necesita
  // un `node_modules` por encima desde el que buscar.
  await mkdir(DESTINO, { recursive: true });
  const nombre = entrada.replace(/[\\/:]/g, "_").replace(/\.tsx$/, ".mjs");
  const archivo = new URL(nombre, DESTINO);
  await writeFile(archivo, codigo, "utf8");
  return import(pathToFileURL(fileURLToPath(archivo)).href);
}
