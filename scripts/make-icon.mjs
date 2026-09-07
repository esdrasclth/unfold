/**
 * Genera el icono base de Unfold (1024x1024 PNG) sin dependencias externas.
 * A partir de él, `npm run tauri icon` produce el .ico y los PNG que Tauri
 * necesita para empaquetar en Windows.
 *
 * Uso: node scripts/make-icon.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SIZE = 1024;
const SS = 2; // supermuestreo para bordes suaves

/** Distancia de un punto a un segmento, para dibujar trazos con extremos redondeados. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distancia con signo a un rectángulo redondeado centrado en el lienzo. */
function distToRoundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

const BG = [36, 33, 29]; // mismo tono que --text del tema claro
const FG = [250, 249, 247];
const ACCENT = [180, 87, 42]; // --accent

function shade(x, y) {
  const c = SIZE / 2;
  const bg = distToRoundedRect(x, y, c, c, 460, 460, 210);
  if (bg > 1) return null; // fuera del icono: transparente

  // La marca: una barra superior (la hoja) y un galón hacia abajo (desplegar).
  const bar = distToSegment(x, y, 352, 372, 672, 372) - 34;
  const chevronLeft = distToSegment(x, y, 352, 512, 512, 668) - 34;
  const chevronRight = distToSegment(x, y, 512, 668, 672, 512) - 34;
  const chevron = Math.min(chevronLeft, chevronRight);

  const alphaBg = Math.max(0, Math.min(1, 0.5 - bg));
  const alphaBar = Math.max(0, Math.min(1, 0.5 - bar));
  const alphaChevron = Math.max(0, Math.min(1, 0.5 - chevron));

  let [r, g, b] = BG;
  if (alphaBar > 0) {
    r = r * (1 - alphaBar) + FG[0] * alphaBar;
    g = g * (1 - alphaBar) + FG[1] * alphaBar;
    b = b * (1 - alphaBar) + FG[2] * alphaBar;
  }
  if (alphaChevron > 0) {
    r = r * (1 - alphaChevron) + ACCENT[0] * alphaChevron;
    g = g * (1 - alphaChevron) + ACCENT[1] * alphaChevron;
    b = b * (1 - alphaChevron) + ACCENT[2] * alphaChevron;
  }
  return [r, g, b, alphaBg * 255];
}

// Render con supermuestreo
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const sample = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (sample) {
          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += sample[3];
        }
      }
    }
    const n = SS * SS;
    const i = (y * SIZE + x) * 4;
    pixels[i] = Math.round(r / n);
    pixels[i + 1] = Math.round(g / n);
    pixels[i + 2] = Math.round(b / n);
    pixels[i + 3] = Math.round(a / n);
  }
}

// --- Codificador PNG mínimo ---------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filtro "none"
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // profundidad de bits
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = "src-tauri/icon-source.png";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Icono escrito en ${out} (${(png.length / 1024).toFixed(1)} KB)`);
