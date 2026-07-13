/**
 * Catálogo data-driven del cake builder (Reto 3). Cada paso del wizard lee
 * de aquí, así que sumar/quitar una opción es editar datos, no tocar
 * componentes. Assets procesados en `scripts/process-cake-assets.mjs` (ver
 * `docs/challenge-3.md`).
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
    width: 1022,
    height: 885,
  },
  {
    tiers: 2,
    label: "Dos pisos",
    image: `${ASSET_BASE}/bases/two-tier-cream.webp`,
    width: 904,
    height: 902,
  },
];

export const BASE_OPTIONS: Record<Tiers, CakeImageOption[]> = {
  1: [
    {
      id: "one-tier-cream",
      label: "Crema",
      image: `${ASSET_BASE}/bases/one-tier-cream.webp`,
      width: 1022,
      height: 885,
    },
    {
      id: "one-tier-blush",
      label: "Rosado",
      image: `${ASSET_BASE}/bases/one-tier-blush.webp`,
      width: 859,
      height: 713,
    },
    {
      id: "one-tier-yellow",
      label: "Amarillo",
      image: `${ASSET_BASE}/bases/one-tier-yellow.webp`,
      width: 966,
      height: 741,
    },
    {
      id: "one-tier-lilac",
      label: "Lila",
      image: `${ASSET_BASE}/bases/one-tier-lilac.webp`,
      width: 921,
      height: 778,
    },
    {
      id: "one-tier-chocolate",
      label: "Chocolate",
      image: `${ASSET_BASE}/bases/one-tier-chocolate.webp`,
      width: 1012,
      height: 791,
    },
  ],
  2: [
    {
      id: "two-tier-cream",
      label: "Crema",
      image: `${ASSET_BASE}/bases/two-tier-cream.webp`,
      width: 904,
      height: 902,
    },
    {
      id: "two-tier-cream-blush",
      label: "Crema y rosado",
      image: `${ASSET_BASE}/bases/two-tier-cream-blush.webp`,
      width: 902,
      height: 882,
    },
    {
      id: "two-tier-cream-yellow",
      label: "Crema y amarillo",
      image: `${ASSET_BASE}/bases/two-tier-cream-yellow.webp`,
      width: 1026,
      height: 963,
    },
  ],
};

export const STAND_OPTIONS: CakeImageOption[] = [
  {
    id: "stand-blush",
    label: "Rosado",
    image: `${ASSET_BASE}/stands/stand-blush.webp`,
    width: 1066,
    height: 678,
  },
  {
    id: "stand-white-gold",
    label: "Blanco con dorado",
    image: `${ASSET_BASE}/stands/stand-white-gold.webp`,
    width: 960,
    height: 593,
  },
];

export const PLAQUE_OPTIONS: CakeImageOption[] = [
  {
    id: "plaque-blush-gold",
    label: "Rosada y dorada",
    image: `${ASSET_BASE}/plaques/plaque-blush-gold.webp`,
    width: 1082,
    height: 727,
  },
  {
    id: "plaque-lilac-gold",
    label: "Lila y dorada",
    image: `${ASSET_BASE}/plaques/plaque-lilac-gold.webp`,
    width: 1090,
    height: 744,
  },
];

export const TOPPER_OPTIONS: CakeImageOption[] = [
  {
    id: "topper-happy-birthday-gold",
    label: "Happy Birthday dorado",
    image: `${ASSET_BASE}/toppers/topper-happy-birthday-gold.webp`,
    width: 1000,
    height: 1008,
  },
  {
    id: "topper-feliz-cumpleanos-bow",
    label: "Feliz Cumpleaños con lazo",
    image: `${ASSET_BASE}/toppers/topper-feliz-cumpleanos-bow.webp`,
    width: 963,
    height: 890,
  },
  {
    id: "topper-happy-birthday-30",
    label: "Happy Birthday 30",
    image: `${ASSET_BASE}/toppers/topper-happy-birthday-30.webp`,
    width: 938,
    height: 1046,
  },
  {
    id: "topper-princess",
    label: "Princess",
    image: `${ASSET_BASE}/toppers/topper-princess.webp`,
    width: 892,
    height: 822,
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
