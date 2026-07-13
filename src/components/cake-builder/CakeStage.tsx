import Image from "next/image";
import {
  getBaseOption,
  getPlaqueOption,
  getStandOption,
  getTopperOption,
} from "@/lib/cake-builder/options";
import type { CakeDesign, CakeImageOption } from "@/lib/cake-builder/types";

interface CakeStageProps {
  design: CakeDesign;
}

// Anchos como % del ancho del stage.
const STAND_WIDTH = 82;
const CAKE_WIDTH = 58;
const TOPPER_WIDTH = 20;
const PLAQUE_WIDTH = 34;

// Fracción de la altura PROPIA de cada capa que se hunde en la capa de
// abajo (no una altura fija: cada asset tiene su propio recorte real, y
// una torta de 2 pisos es bastante más alta que una de 1 piso con el
// mismo ancho — un offset fijo relativo al stage descuadraba el topper
// en cuanto cambiaba el número de pisos).
const TOPPER_SINK_FRACTION = 0.18;
const CAKE_SINK_FRACTION = 0.3;
const PLAQUE_TOP_FRACTION = 0.56; // % de la altura propia de la torta

/**
 * -(overlapFraction * widthPercent) / aspectRatio: el margen porcentual
 * de CSS siempre se resuelve contra el ANCHO del contenedor (nunca la
 * altura, ni en flex-column), así que expresarlo en función del ancho
 * renderizado propio de la capa (que sí conocemos) da el mismo resultado
 * visual para cualquier imagen, sin importar su relación de aspecto.
 */
function sinkMarginPercent(overlapFraction: number, widthPercent: number, option: CakeImageOption) {
  const aspect = option.width / option.height;
  return -(overlapFraction * widthPercent) / aspect;
}

/**
 * Vista previa de la torta: apila pedestal, torta (con placa + mensaje
 * encima) y topper en flujo normal, con márgenes negativos calculados por
 * imagen para que se superpongan lo justo. El orden en el DOM decide el
 * apilado visual (más abajo = más al frente); z-index corrige el único
 * caso en que eso no basta: la torta debe tapar tanto la base de los
 * palitos del topper como la parte del pedestal que queda debajo.
 */
export default function CakeStage({ design }: CakeStageProps) {
  const base = getBaseOption(design.tiers, design.baseVariant);
  const stand = getStandOption(design.standVariant);
  const plaque = getPlaqueOption(design.plaqueVariant);
  const topper = getTopperOption(design.topperVariant);

  return (
    <div className="mx-auto flex w-full max-w-sm select-none flex-col items-center">
      {topper && (
        <Image
          src={topper.image}
          alt=""
          width={topper.width}
          height={topper.height}
          style={{
            width: `${TOPPER_WIDTH}%`,
            marginBottom: `${sinkMarginPercent(TOPPER_SINK_FRACTION, TOPPER_WIDTH, topper)}%`,
            zIndex: 1,
          }}
          className="h-auto"
          priority
        />
      )}

      {base && (
        <div
          className="relative"
          style={{
            width: `${CAKE_WIDTH}%`,
            marginBottom: `${sinkMarginPercent(CAKE_SINK_FRACTION, CAKE_WIDTH, base)}%`,
            zIndex: 2,
          }}
        >
          <Image
            src={base.image}
            alt={`Torta ${base.label.toLowerCase()}`}
            width={base.width}
            height={base.height}
            className="h-auto w-full"
            priority
          />

          {plaque && (
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                width: `${(PLAQUE_WIDTH / CAKE_WIDTH) * 100}%`,
                top: `${PLAQUE_TOP_FRACTION * 100}%`,
              }}
            >
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
          )}
        </div>
      )}

      {stand && (
        <Image
          src={stand.image}
          alt=""
          width={stand.width}
          height={stand.height}
          style={{ width: `${STAND_WIDTH}%`, zIndex: 1 }}
          className="h-auto"
          priority
        />
      )}
    </div>
  );
}
