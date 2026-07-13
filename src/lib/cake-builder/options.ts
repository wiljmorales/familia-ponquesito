/**
 * Catálogo data-driven del cake builder (Reto 3). Cada paso del wizard lee
 * de aquí, así que sumar/quitar una opción es editar datos, no tocar
 * componentes. Assets procesados en `scripts/process-cake-assets.mjs` (ver
 * `docs/challenge-3.md`).
 *
 * width/height de cada opción deben coincidir con el archivo real (hay una
 * prueba que lo verifica: options.test.ts).
 */
import type { CakeDesign, CakeImageOption, StepId, Tiers } from "./types";

const ASSET_BASE = "/assets/cake-builder";

export const STEP_ORDER: StepId[] = [
  "bienvenida",
  "tiers",
  "color",
  "pedestal",
  "placa",
  "mensaje",
  "topper",
  "final",
];

export const MAX_MESSAGE_LENGTH = 40;

interface TierOption {
  tiers: Tiers;
  label: string;
  /** Reutiliza la variante crema (existe para 1 y 2 pisos) como miniatura. */
  image: string;
  width: number;
  height: number;
}

export const TIER_OPTIONS: TierOption[] = [
  {
    tiers: 1,
    label: "Un piso",
    image: `${ASSET_BASE}/bases/one-tier-cream.webp`,
    width: 1024,
    height: 883,
  },
  {
    tiers: 2,
    label: "Dos pisos",
    image: `${ASSET_BASE}/bases/two-tier-cream.webp`,
    width: 904,
    height: 899,
  },
];

export const BASE_OPTIONS: Record<Tiers, CakeImageOption[]> = {
  1: [
    {
      id: "one-tier-cream",
      label: "Crema",
      image: `${ASSET_BASE}/bases/one-tier-cream.webp`,
      width: 1024,
      height: 883,
    },
    {
      id: "one-tier-blush",
      label: "Rosado",
      image: `${ASSET_BASE}/bases/one-tier-blush.webp`,
      width: 861,
      height: 715,
    },
    {
      id: "one-tier-yellow",
      label: "Amarillo",
      image: `${ASSET_BASE}/bases/one-tier-yellow.webp`,
      width: 967,
      height: 737,
    },
    {
      id: "one-tier-lilac",
      label: "Lila",
      image: `${ASSET_BASE}/bases/one-tier-lilac.webp`,
      width: 922,
      height: 779,
    },
    {
      id: "one-tier-chocolate",
      label: "Chocolate",
      image: `${ASSET_BASE}/bases/one-tier-chocolate.webp`,
      width: 1014,
      height: 793,
    },
  ],
  2: [
    {
      id: "two-tier-cream",
      label: "Crema",
      image: `${ASSET_BASE}/bases/two-tier-cream.webp`,
      width: 904,
      height: 899,
    },
    {
      id: "two-tier-cream-blush",
      label: "Crema y rosado",
      image: `${ASSET_BASE}/bases/two-tier-cream-blush.webp`,
      width: 902,
      height: 883,
    },
    {
      id: "two-tier-cream-yellow",
      label: "Crema y amarillo",
      image: `${ASSET_BASE}/bases/two-tier-cream-yellow.webp`,
      width: 1029,
      height: 964,
    },
  ],
};

export const STAND_OPTIONS: CakeImageOption[] = [
  {
    id: "stand-blush",
    label: "Rosado",
    image: `${ASSET_BASE}/stands/stand-blush.webp`,
    width: 1067,
    height: 675,
  },
  {
    id: "stand-white-gold",
    label: "Blanco con dorado",
    image: `${ASSET_BASE}/stands/stand-white-gold.webp`,
    width: 963,
    height: 590,
  },
];

export const PLAQUE_OPTIONS: CakeImageOption[] = [
  {
    id: "plaque-blush-gold",
    label: "Rosada y dorada",
    image: `${ASSET_BASE}/plaques/plaque-blush-gold.webp`,
    width: 1085,
    height: 729,
  },
  {
    id: "plaque-lilac-gold",
    label: "Lila y dorada",
    image: `${ASSET_BASE}/plaques/plaque-lilac-gold.webp`,
    width: 1093,
    height: 746,
  },
];

export const TOPPER_OPTIONS: CakeImageOption[] = [
  {
    id: "topper-happy-birthday-gold",
    label: "Happy Birthday dorado",
    image: `${ASSET_BASE}/toppers/topper-happy-birthday-gold.webp`,
    width: 1002,
    height: 1011,
  },
  {
    id: "topper-feliz-cumpleanos-bow",
    label: "Feliz Cumpleaños con lazo",
    image: `${ASSET_BASE}/toppers/topper-feliz-cumpleanos-bow.webp`,
    width: 966,
    height: 892,
  },
  {
    id: "topper-happy-birthday-30",
    label: "Happy Birthday 30",
    image: `${ASSET_BASE}/toppers/topper-happy-birthday-30.webp`,
    width: 940,
    height: 1048,
  },
  {
    id: "topper-princess",
    label: "Princess",
    image: `${ASSET_BASE}/toppers/topper-princess.webp`,
    width: 894,
    height: 824,
  },
];

export const DEFAULT_DESIGN: CakeDesign = {
  version: 1,
  tiers: 1,
  baseVariant: "one-tier-cream",
  standVariant: "stand-blush",
  plaqueVariant: null,
  message: "",
  topperVariant: null,
};

export function getBaseOption(tiers: Tiers, id: string): CakeImageOption | undefined {
  return BASE_OPTIONS[tiers].find((option) => option.id === id);
}

export function getStandOption(id: string): CakeImageOption | undefined {
  return STAND_OPTIONS.find((option) => option.id === id);
}

export function getPlaqueOption(id: string | null): CakeImageOption | undefined {
  if (!id) return undefined;
  return PLAQUE_OPTIONS.find((option) => option.id === id);
}

export function getTopperOption(id: string | null): CakeImageOption | undefined {
  if (!id) return undefined;
  return TOPPER_OPTIONS.find((option) => option.id === id);
}

/** Primera variante de color disponible para un número de pisos dado. */
export function firstBaseVariant(tiers: Tiers): string {
  return BASE_OPTIONS[tiers][0].id;
}
