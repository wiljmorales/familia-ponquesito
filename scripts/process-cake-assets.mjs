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
// El modelo, a su vez, tiene su propio problema en las placas: interpretó
// el relleno crema del interior (una superficie lisa y clara) como fondo
// y lo borró por completo (~54% del área de la imagen), dejando solo el
// marco decorativo. Se detectó comparando, para cada asset ya procesado,
// qué fracción de los píxeles transparentes NO está conectada al borde de
// la imagen (un agujero real de fondo siempre toca el borde; un agujero
// "encerrado" por completo dentro del objeto no debería existir en un
// objeto sólido como una placa). Los toppers con script cursivo sí tienen
// agujeros encerrados legítimos y pequeños (los lazos de letras como "H"
// o "y", hasta ~17% del área) que no hay que tocar. Por eso solo se
// rellenan agujeros grandes (>=25%, muy por encima del máximo legítimo
// observado), usando el color de la imagen ORIGINAL en esa zona — el
// canal RGB que deja el modelo de segmentación en el área que borró no
// es confiable (no es el color real).
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

const ALPHA_BG_THRESHOLD = 10;
const LARGE_HOLE_FRACTION = 0.25; // 25% del área total de la imagen

// El modelo de segmentación deja bordes suavizados y, en varios assets,
// una sombra/degradado semitransparente de varias decenas de píxeles
// (no un simple antialiasing de 2-3px). sharp .trim() no lo recorta con
// threshold bajo, así que queda un margen "fantasma" casi transparente
// que se nota como hueco al apilar capas en flujo normal. Por eso el
// recorte no usa .trim(): se calcula el bounding box de los píxeles
// realmente SÓLIDOS (alpha alto) y se recorta ahí, conservando el
// degradado suave dentro de ese recuadro (no se pierde antialiasing real,
// solo se ignora la cola larga de sombra/desvanecido para decidir dónde
// cortar).
const SOLID_ALPHA_THRESHOLD = 200;
const CROP_PADDING_PX = 3;

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

/**
 * Etiqueta componentes conexas (4-conectividad) de píxeles transparentes
 * que NO están alcanzados por un flood fill desde el borde de la imagen
 * (es decir, agujeros encerrados dentro del objeto). Rellena con el color
 * original + alpha opaco cualquier componente que supere el umbral de
 * tamaño; dejando intactos los agujeros pequeños (decorativos/legítimos).
 */
function fillLargeEnclosedHoles(rgba, srcRgb, width, height) {
  const total = width * height;
  const alpha = new Uint8Array(total);
  for (let i = 0; i < total; i++) alpha[i] = rgba[i * 4 + 3];

  const isTransparent = (idx) => alpha[idx] <= ALPHA_BG_THRESHOLD;

  // 1) Flood fill desde el borde: todo lo transparente alcanzable desde
  // ahí es fondo real, no un agujero interior.
  const reachedFromBorder = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;
  function tryEnqueue(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (reachedFromBorder[idx] || !isTransparent(idx)) return;
    reachedFromBorder[idx] = 1;
    queue[qTail++] = idx;
  }
  for (let x = 0; x < width; x++) {
    tryEnqueue(x, 0);
    tryEnqueue(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryEnqueue(0, y);
    tryEnqueue(width - 1, y);
  }
  while (qHead < qTail) {
    const idx = queue[qHead++];
    const x = idx % width;
    const y = (idx / width) | 0;
    tryEnqueue(x - 1, y);
    tryEnqueue(x + 1, y);
    tryEnqueue(x, y - 1);
    tryEnqueue(x, y + 1);
  }

  // 2) Etiqueta componentes conexas entre los transparentes restantes
  // (agujeros encerrados) y mide su tamaño.
  const componentId = new Int32Array(total).fill(-1);
  const componentSizes = [];
  const labelQueue = new Int32Array(total);

  for (let start = 0; start < total; start++) {
    if (!isTransparent(start) || reachedFromBorder[start] || componentId[start] !== -1) continue;

    const id = componentSizes.length;
    let size = 0;
    let lqHead = 0;
    let lqTail = 0;
    labelQueue[lqTail++] = start;
    componentId[start] = id;

    while (lqHead < lqTail) {
      const idx = labelQueue[lqHead++];
      size++;
      const x = idx % width;
      const y = (idx / width) | 0;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (!isTransparent(nIdx) || reachedFromBorder[nIdx] || componentId[nIdx] !== -1) continue;
        componentId[nIdx] = id;
        labelQueue[lqTail++] = nIdx;
      }
    }
    componentSizes.push(size);
  }

  // 3) Rellena las componentes grandes con el color de la imagen original.
  const thresholdPixels = total * LARGE_HOLE_FRACTION;
  const out = Buffer.from(rgba);
  let filledPixels = 0;
  for (let idx = 0; idx < total; idx++) {
    const id = componentId[idx];
    if (id === -1) continue;
    if (componentSizes[id] < thresholdPixels) continue;
    out[idx * 4] = srcRgb[idx * 3];
    out[idx * 4 + 1] = srcRgb[idx * 3 + 1];
    out[idx * 4 + 2] = srcRgb[idx * 3 + 2];
    out[idx * 4 + 3] = 255;
    filledPixels++;
  }

  let largestComponent = 0;
  for (const size of componentSizes) largestComponent = Math.max(largestComponent, size);

  return { buffer: out, filledPixels, largestHolePct: total ? (largestComponent / total) * 100 : 0 };
}

/** Bounding box (con margen) de los píxeles con alpha >= SOLID_ALPHA_THRESHOLD. */
function solidBoundingBox(rgba, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < SOLID_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX === -1) {
    // Ningún píxel sólido (no debería pasar): no recorta nada.
    return { left: 0, top: 0, width, height };
  }

  const left = Math.max(0, minX - CROP_PADDING_PX);
  const top = Math.max(0, minY - CROP_PADDING_PX);
  const right = Math.min(width, maxX + 1 + CROP_PADDING_PX);
  const bottom = Math.min(height, maxY + 1 + CROP_PADDING_PX);

  return { left, top, width: right - left, height: bottom - top };
}

async function processOne({ file, out }) {
  const srcPath = path.join(SRC_DIR, file);
  const outPath = path.join(OUT_DIR, out);
  await mkdir(path.dirname(outPath), { recursive: true });

  const blob = await removeBackground(srcPath, {
    output: { format: "image/png" },
  });
  const imglyBuffer = Buffer.from(await blob.arrayBuffer());

  const { data: imglyRgba, info } = await sharp(imglyBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: srcRgb } = await sharp(srcPath)
    .resize(info.width, info.height) // no-op si ya coincide; red de seguridad
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { buffer: filledRgba, filledPixels, largestHolePct } = fillLargeEnclosedHoles(
    imglyRgba,
    srcRgb,
    info.width,
    info.height,
  );

  // El lienzo original deja mucho margen transparente alrededor del
  // objeto; recortar al bounding box de contenido SÓLIDO (no solo "no
  // transparente") simplifica alinear las capas (base/pedestal/placa/
  // topper) sobre un mismo punto de anclaje, sin dejar colas de sombra
  // semitransparente que se noten como huecos al apilar.
  const bbox = solidBoundingBox(filledRgba, info.width, info.height);
  const buffer = await sharp(filledRgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(bbox)
    .webp({ quality: 92 })
    .toBuffer();
  await writeFile(outPath, buffer);

  const { width, height } = await sharp(buffer).metadata();
  const holeNote = filledPixels > 0 ? `, agujero interior relleno (${largestHolePct.toFixed(0)}% del área)` : "";
  console.log(`${out} <- ${file} (${width}x${height}, ${(buffer.length / 1024).toFixed(0)} KB${holeNote})`);
}

for (const asset of ASSETS) {
  await processOne(asset);
}
console.log(`\nListo: ${ASSETS.length} assets procesados en ${OUT_DIR}`);
