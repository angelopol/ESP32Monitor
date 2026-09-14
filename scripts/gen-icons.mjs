// Genera los iconos PNG del proyecto sin dependencias (encoder PNG a mano).
// Un rayo ambar sobre fondo azul oscuro (estilo del theme).
//
//   node scripts/gen-icons.mjs
//
// Genera:
//   public/icon-192.png / icon-512.png   -> manifest, purpose "any" (sangrado completo)
//   public/icon-mask-512.png             -> manifest, purpose "maskable" (con margen de seguridad)
//   public/apple-icon.png (180x180)      -> apple-touch-icon para iOS/iPadOS (Safari no lee el manifest para esto)
//   public/splash/*.png                  -> apple-touch-startup-image para los tamaños de iPhone mas comunes

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public");
const SPLASH_DIR = join(OUT_DIR, "splash");

// --- PNG encoder minimo (RGBA, sin filtro) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- dibujo ---
// Rayo en coordenadas normalizadas (0..1), pensado para sangrado completo.
const BOLT_FULL_BLEED = [
  [0.56, 0.06],
  [0.28, 0.55],
  [0.46, 0.55],
  [0.4, 0.94],
  [0.74, 0.4],
  [0.54, 0.4],
];

// Version con margen de seguridad (~65%) para iconos "maskable" (Android) y
// apple-touch-icon (iOS aplica su propia mascara redondeada: mejor no ir al borde).
function scalePoly(poly, s, cx = 0.5, cy = 0.5) {
  return poly.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
}
const BOLT_SAFE = scalePoly(BOLT_FULL_BLEED, 0.65);

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

const BG = [15, 23, 42, 255]; // #0f172a
const FG = [245, 158, 11, 255]; // #f59e0b

/** Dibuja el rayo dentro de un cuadrado [size x size], con supersampling. */
function drawIconSquare(size, poly = BOLT_FULL_BLEED) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 2; // supersampling para bordes suaves
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x + (sx + 0.5) / ss) / size;
          const ny = (y + (sy + 0.5) / ss) / size;
          if (inPolygon(nx, ny, poly)) covered++;
        }
      }
      const a = covered / (ss * ss);
      const o = (y * size + x) * 4;
      rgba[o] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      rgba[o + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      rgba[o + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      rgba[o + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

/**
 * Splash screen de iOS: fondo solido + el rayo centrado a un tamano fijo en
 * pixeles. Solo corre el test de poligono dentro de la caja del icono (rapido
 * incluso para pantallas grandes); el resto se rellena directo con el fondo.
 */
function drawSplash(width, height, iconPx) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = BG[0];
    rgba[i * 4 + 1] = BG[1];
    rgba[i * 4 + 2] = BG[2];
    rgba[i * 4 + 3] = 255;
  }

  const left = Math.round((width - iconPx) / 2);
  const top = Math.round((height - iconPx) / 2);
  const ss = 2;
  for (let y = 0; y < iconPx; y++) {
    for (let x = 0; x < iconPx; x++) {
      let covered = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x + (sx + 0.5) / ss) / iconPx;
          const ny = (y + (sy + 0.5) / ss) / iconPx;
          if (inPolygon(nx, ny, BOLT_SAFE)) covered++;
        }
      }
      if (covered === 0) continue;
      const a = covered / (ss * ss);
      const px = left + x;
      const py = top + y;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const o = (py * width + px) * 4;
      rgba[o] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      rgba[o + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      rgba[o + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      rgba[o + 3] = 255;
    }
  }
  return encodePng(width, height, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(SPLASH_DIR, { recursive: true });

// Manifest (Android/Chrome): "any" a sangre completa.
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, drawIconSquare(size));
  console.log("escrito", file);
}

// Manifest: "maskable" con margen de seguridad para el recorte circular/redondeado.
{
  const file = join(OUT_DIR, "icon-mask-512.png");
  writeFileSync(file, drawIconSquare(512, BOLT_SAFE));
  console.log("escrito", file);
}

// iOS/iPadOS: apple-touch-icon. Safari NO lee el manifest para esto.
{
  const file = join(OUT_DIR, "apple-icon.png");
  writeFileSync(file, drawIconSquare(180, BOLT_SAFE));
  console.log("escrito", file);
}

// iOS: splash screens (apple-touch-startup-image) para los tamanos de iPhone
// mas comunes. El icono ocupa ~28% del lado corto de la pantalla.
const SPLASH_SIZES = [
  { w: 1170, h: 2532, name: "iphone-6.1-3x" }, // 12/13/14, 15/16 estandar
  { w: 1284, h: 2778, name: "iphone-6.7-3x" }, // 12/13/14/15/16 Pro Max
  { w: 1179, h: 2556, name: "iphone-15-16-3x" }, // 15/16 Pro
  { w: 750, h: 1334, name: "iphone-se-2x" }, // SE / 8 / 7 / 6s
];
for (const { w, h, name } of SPLASH_SIZES) {
  const file = join(SPLASH_DIR, `${name}.png`);
  writeFileSync(file, drawSplash(w, h, Math.round(Math.min(w, h) * 0.28)));
  console.log("escrito", file);
}
