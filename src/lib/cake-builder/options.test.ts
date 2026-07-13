import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  BASE_OPTIONS,
  PLAQUE_OPTIONS,
  STAND_OPTIONS,
  TIER_OPTIONS,
  TOPPER_OPTIONS,
} from "./options";
import type { CakeImageOption } from "./types";

/**
 * CakeStage posiciona las capas con matemática basada en width/height
 * (ver sinkMarginPercent en CakeStage.tsx): si estos números no coinciden
 * con el archivo real, el resultado se desalinea de forma sutil sin que
 * ningún tipo lo detecte. Pasó de verdad una vez (ver docs/challenge-3.md,
 * "Etapa 5") — esta prueba evita que vuelva a pasar en silencio.
 */
const PUBLIC_DIR = path.join(__dirname, "..", "..", "..", "public");

async function realDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const absolutePath = path.join(PUBLIC_DIR, imagePath.replace(/^\//, ""));
  const buffer = readFileSync(absolutePath);
  const metadata = await sharp(buffer).metadata();
  return { width: metadata.width!, height: metadata.height! };
}

function collectAllOptions(): CakeImageOption[] {
  return [
    ...BASE_OPTIONS[1],
    ...BASE_OPTIONS[2],
    ...STAND_OPTIONS,
    ...PLAQUE_OPTIONS,
    ...TOPPER_OPTIONS,
    ...TIER_OPTIONS.map((t) => ({ id: `tier-${t.tiers}`, label: t.label, image: t.image, width: t.width, height: t.height })),
  ];
}

describe("catálogo de assets del cake builder", () => {
  it.each(collectAllOptions())(
    "width/height de $id coincide con el archivo real ($image)",
    async (option) => {
      const real = await realDimensions(option.image);
      expect({ width: option.width, height: option.height }).toEqual(real);
    },
  );
});
