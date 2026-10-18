// PNG válido (RGB 1000×1000, ruido) de exactamente N bytes: el resto se rellena
// con un fragmento auxiliar privado («fpPd»), que los visores ignoran.
// Uso como programa: node deploy/staging/test/png-exacto.mjs <salida> [bytes=4000000]
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

export function pngExacto(total = 4_000_000) {
  const w = 1000, h = 1000;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((3 * w + 1) * h);
  for (let y = 0; y < h; y++) randomBytes(3 * w).copy(raw, y * (3 * w + 1) + 1);
  // Nivel 0 (sin comprimir): tamaño determinista.
  const partes = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 0 }))];
  const fin = chunk("IEND", Buffer.alloc(0));
  const relleno = total - partes.reduce((n, b) => n + b.length, 0) - fin.length - 12;
  if (relleno < 0) throw new Error(`${total} bytes es demasiado poco para la imagen`);
  const png = Buffer.concat([...partes, chunk("fpPd", Buffer.alloc(relleno)), fin]);
  if (png.length !== total) throw new Error("tamaño inesperado");
  return png;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const salida = process.argv[2];
  if (!salida) { console.error("Uso: node png-exacto.mjs <salida> [bytes]"); process.exit(2); }
  const png = pngExacto(Number(process.argv[3] ?? 4_000_000));
  writeFileSync(salida, png, { flag: "wx" });
  console.log(`${salida}: ${png.length} bytes, sha256 ${createHash("sha256").update(png).digest("hex")}`);
}
