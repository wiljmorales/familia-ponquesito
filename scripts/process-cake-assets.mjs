// Reto 3 — recorta el fondo de los PNG generados por ChatGPT para el cake
// builder y produce WebP con canal alpha real, con nombres semánticos, en
// public/assets/cake-builder/.
//
// El fondo de los PNG fuente no es transparencia real (verificado con
// `sharp().metadata().hasAlpha === false`): es una cuadrícula gris/blanca
// pintada como píxeles. Un umbral de color simple + flood fill no sirve
// aquí (se probó y falló): el pedestal blanco-dorado es casi del mismo
// tono que el fondo y quedaba borrado por completo, y los trazos finos de
// los toppers desaparecían con cualquier erosión. Por eso se usa un modelo
// de segmentación real (@imgly/background-removal-node, devDependency —
// no se importa desde src/, nunca viaja al bundle de la app).
//
// Uso: node scripts/process-cake-assets.mjs

import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = "/home/wiljmorales/Downloads/juego FP";
const OUT_DIR = path.join(__dirname, "..", "public", "assets", "cake-builder");

const ASSETS = [
  { file: "ChatGPT Image Jul 12, 2026, 11_25_24 PM (1).png", out: "stands/stand-blush.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_25_24 PM (2).png", out: "bases/one-tier-cream.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_25_24 PM (3).png", out: "bases/two-tier-cream.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_25_24 PM (4).png", out: "plaques/plaque-blush-gold.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_20 PM (1).png", out: "bases/one-tier-blush.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_21 PM (2).png", out: "bases/one-tier-yellow.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_21 PM (3).png", out: "bases/one-tier-lilac.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_21 PM (4).png", out: "bases/one-tier-chocolate.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_22 PM (5).png", out: "bases/two-tier-cream-blush.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_24 PM (6).png", out: "bases/two-tier-cream-yellow.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_24 PM (7).png", out: "stands/stand-white-gold.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_26_24 PM (8).png", out: "plaques/plaque-lilac-gold.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_29_05 PM (1).png", out: "toppers/topper-happy-birthday-gold.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_29_05 PM (2).png", out: "toppers/topper-happy-birthday-30.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_29_05 PM (3).png", out: "toppers/topper-princess.webp" },
  { file: "ChatGPT Image Jul 12, 2026, 11_29_06 PM (5).png", out: "toppers/topper-feliz-cumpleanos-bow.webp" },
  // Excluido a propósito: "11_29_06 PM (4).png" (topper de abejas/flores)
  // trae el nombre "Alana" horneado en la imagen; no sirve como plantilla
  // genérica. Ver docs/challenge-3.md.
];

async function processOne({ file, out }) {
  const srcPath = path.join(SRC_DIR, file);
  const outPath = path.join(OUT_DIR, out);
  await mkdir(path.dirname(outPath), { recursive: true });

  const blob = await removeBackground(srcPath, {
    output: { format: "image/png" },
  });
  const rawBuffer = Buffer.from(await blob.arrayBuffer());

  // El lienzo original deja mucho margen transparente alrededor del
  // objeto; recortar al bounding box real simplifica alinear las capas
  // (base/pedestal/placa/topper) sobre un mismo punto de anclaje.
  const buffer = await sharp(rawBuffer)
    .trim({ threshold: 10 })
    .webp({ quality: 92 })
    .toBuffer();
  await writeFile(outPath, buffer);

  const { width, height } = await sharp(buffer).metadata();
  console.log(`${out} <- ${file} (${width}x${height}, ${(buffer.length / 1024).toFixed(0)} KB)`);
}

for (const asset of ASSETS) {
  await processOne(asset);
}
console.log(`\nListo: ${ASSETS.length} assets procesados en ${OUT_DIR}`);
