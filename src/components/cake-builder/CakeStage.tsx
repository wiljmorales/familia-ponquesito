import Image from "next/image";
import {
  getBaseOption,
  getPlaqueOption,
  getStandOption,
  getTopperOption,
} from "@/lib/cake-builder/options";
import type { CakeDesign } from "@/lib/cake-builder/types";

interface CakeStageProps {
  design: CakeDesign;
}

/**
 * Vista previa de la torta: apila las capas (pedestal, torta, placa +
 * mensaje, topper) sobre un mismo lienzo. Los offsets son porcentajes
 * ajustados a ojo contra los assets reales (ver docs/challenge-3.md); no
 * hay puntos de anclaje exactos en los PNG fuente.
 */
export default function CakeStage({ design }: CakeStageProps) {
  const base = getBaseOption(design.tiers, design.baseVariant);
  const stand = getStandOption(design.standVariant);
  const plaque = getPlaqueOption(design.plaqueVariant);
  const topper = getTopperOption(design.topperVariant);

  return (
    <div className="relative mx-auto aspect-[4/5] w-full max-w-sm select-none">
      {stand && (
        <div className="absolute inset-x-0 bottom-[6%] flex justify-center">
          <Image
            src={stand.image}
            alt=""
            width={stand.width}
            height={stand.height}
            className="h-auto w-[82%]"
            priority
          />
        </div>
      )}

      {base && (
        <div className="absolute inset-x-0 bottom-[22%] flex justify-center">
          <Image
            src={base.image}
            alt={`Torta ${base.label.toLowerCase()}`}
            width={base.width}
            height={base.height}
            className="h-auto w-[58%]"
            priority
          />
        </div>
      )}

      {plaque && (
        <div className="absolute inset-x-0 bottom-[28%] flex justify-center">
          <div className="relative w-[34%]">
            <Image
              src={plaque.image}
              alt=""
              width={plaque.width}
              height={plaque.height}
              className="h-auto w-full"
            />
            {design.message && (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-[26%] py-[30%] text-center font-script text-[0.5rem] leading-[1.1] text-cocoa sm:text-[0.7rem]">
                {design.message}
              </p>
            )}
          </div>
        </div>
      )}

      {topper && (
        <div className="absolute inset-x-0 bottom-[47%] flex justify-center">
          <Image
            src={topper.image}
            alt=""
            width={topper.width}
            height={topper.height}
            className="h-auto w-[20%]"
          />
        </div>
      )}
    </div>
  );
}
