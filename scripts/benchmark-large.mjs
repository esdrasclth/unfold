import { performance } from "node:perf_hooks";
import { markdownToHtml } from "../src/export/markdownToHtml.ts";

for (const lines of [10_000, 100_000]) {
  const source = Array.from({ length: lines }, (_, i) => `## Línea ${i + 1}\nTexto de medición`).join("\n");
  const start = performance.now();
  const html = markdownToHtml(source);
  console.log(`${lines.toLocaleString("es-ES")} líneas: ${Math.round(performance.now() - start)} ms, ${(html.length / 1024 / 1024).toFixed(2)} MiB HTML`);
}
