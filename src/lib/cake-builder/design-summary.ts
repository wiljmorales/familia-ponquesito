import {
  TIER_OPTIONS,
  getBaseOption,
  getPlaqueOption,
  getStandOption,
  getTopperOption,
} from "./options";
import type { CakeDesign } from "./types";

/**
 * Resumen en texto de un CakeDesign (piso, color, pedestal, placa +
 * dedicatoria, topper). Compartido entre la vista final del builder
 * (FinalView.tsx) y el correo de notificación a Karem (Reto 4), para no
 * mantener dos versiones del mismo resumen.
 */
export function describeCakeDesign(design: CakeDesign): string[] {
  const tierLabel = TIER_OPTIONS.find((t) => t.tiers === design.tiers)?.label;
  const base = getBaseOption(design.tiers, design.baseVariant);
  const stand = getStandOption(design.standVariant);
  const plaque = getPlaqueOption(design.plaqueVariant);
  const topper = getTopperOption(design.topperVariant);

  return [
    tierLabel && `Torta de ${tierLabel.toLowerCase()}`,
    base && `Color ${base.label.toLowerCase()}`,
    stand && `Pedestal ${stand.label.toLowerCase()}`,
    plaque
      ? `Placa ${plaque.label.toLowerCase()}${design.message ? ` con "${design.message}"` : ""}`
      : "Sin placa",
    topper ? `Topper: ${topper.label}` : "Sin topper",
  ].filter((line): line is string => Boolean(line));
}
