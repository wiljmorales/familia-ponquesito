export type Tiers = 1 | 2;

export interface CakeImageOption {
  id: string;
  label: string;
  image: string;
  width: number;
  height: number;
}

/** `null` representa la opción "sin placa" / "sin topper". */
export interface CakeDesign {
  version: 1;
  tiers: Tiers;
  baseVariant: string;
  standVariant: string;
  plaqueVariant: string | null;
  message: string;
  topperVariant: string | null;
}

export type StepId =
  | "bienvenida"
  | "tiers"
  | "color"
  | "pedestal"
  | "placa"
  | "mensaje"
  | "topper";
