/**
 * Arte del instalador, sin dependencias externas.
 *
 * NSIS sólo acepta BMP, así que no vale reutilizar el PNG del icono. Se dibuja
 * a 4x y se coloca con `NSD_SetStretchedBitmap`, que escala según los puntos de
 * diálogo: así el logotipo no se queda pequeño en pantallas al 150 %.
 *
 * Uso: node scripts/make-installer-art.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";

const FONDO = [253, 252, 250]; // --canvas del tema claro
const TINTA = [36, 33, 29];
const PAPEL = [250, 249, 247];
const ACENTO = [180, 87, 42];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToRoundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  );
}

function mezcla(base, encima, alfa) {
  return [
    base[0] * (1 - alfa) + encima[0] * alfa,
    base[1] * (1 - alfa) + encima[1] * alfa,
    base[2] * (1 - alfa) + encima[2] * alfa,
  ];
}

/** La misma marca del icono de la app, sobre el fondo del instalador. */
function marca(size) {
  const s = size / 256;
  const pixels = [];
  const SS = 3; // supermuestreo

  for (let y = 0; y < size; y++) {
    const fila = [];
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / s;
          const py = (y + (sy + 0.5) / SS) / s;

          const fondoDist = distToRoundedRect(px, py, 128, 128, 118, 118, 54);
          const barra = distToSegment(px, py, 88, 93, 168, 93) - 8.5;
          const izq = distToSegment(px, py, 88, 128, 128, 167) - 8.5;
          const der = distToSegment(px, py, 128, 167, 168, 128) - 8.5;

          const aFondo = Math.max(0, Math.min(1, 0.5 - fondoDist));
          const aBarra = Math.max(0, Math.min(1, 0.5 - barra));
          const aGalon = Math.max(0, Math.min(1, 0.5 - Math.min(izq, der)));

          let color = mezcla(FONDO, TINTA, aFondo);
          color = mezcla(color, PAPEL, aBarra * aFondo);
          color = mezcla(color, ACENTO, aGalon * aFondo);
          r += color[0];
          g += color[1];
          b += color[2];
        }
      }
      const n = SS * SS;
      fila.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
    }
    pixels.push(fila);
  }
  return pixels;
}

/** Rectángulo liso, para las zonas de color plano del instalador. */
function liso(width, height, color) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => color));
}

/**
 * BMP de 24 bits sin comprimir. Las filas van de abajo arriba y alineadas a
 * cuatro bytes, que es lo que espera el formato.
 */
function escribirBmp(ruta, pixels) {
  const height = pixels.length;
  const width = pixels[0].length;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const dataSize = rowSize * height;
  const buffer = Buffer.alloc(54 + dataSize);

  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(54 + dataSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(dataSize, 34);

  for (let y = 0; y < height; y++) {
    const fila = pixels[height - 1 - y];
    let offset = 54 + y * rowSize;
    for (const [r, g, b] of fila) {
      buffer[offset++] = b;
      buffer[offset++] = g;
      buffer[offset++] = r;
    }
  }

  writeFileSync(ruta, buffer);
  return buffer.length;
}

mkdirSync("src-tauri/installer", { recursive: true });

const salidas = [
  // 72 px: se coloca centrado sin estirar, asi que su tamano es el final.
  ["src-tauri/installer/logo.bmp", marca(72)],
  // Franja de acento para separar el pie, en vez de la línea gris del sistema.
  ["src-tauri/installer/accent.bmp", liso(8, 8, ACENTO)],
];

for (const [ruta, pixels] of salidas) {
  const bytes = escribirBmp(ruta, pixels);
  console.log(`${ruta} — ${pixels[0].length}x${pixels.length} (${(bytes / 1024).toFixed(1)} KB)`);
}
