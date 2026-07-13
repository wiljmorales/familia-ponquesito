import { Em } from "@/components/ui/SectionHeading";
import { CakeIcon } from "@/components/ui/icons";
import { FLAVORS } from "@/lib/constants/business";

/*
 * No se proveyeron fotografías reales de corte por sabor (solo tortas
 * decoradas completas) y está prohibido usar fotos de stock o generadas
 * por IA. Cada sabor se representa con un color sólido de la paleta de
 * marca + un ícono, en vez de una foto inventada.
 */
const FLAVOR_STYLES: Record<
  (typeof FLAVORS)[number]["value"],
  { background: string; icon: string }
> = {
  vainilla: { background: "var(--cream)", icon: "var(--terracotta)" },
  chocolate: { background: "var(--cocoa)", icon: "var(--cream-light)" },
  red_velvet: { background: "var(--blush)", icon: "var(--cocoa)" },
  tres_leches: { background: "var(--gold)", icon: "var(--cream-light)" },
};

/** Contenido de la columna "Sabores" (ver nota en HowItWorks.tsx sobre la
 * sección compartida). En mobile el texto queda a la izquierda y los
 * sabores en filas horizontales; en desktop se centra y son tarjetas. */
export default function Flavors() {
  return (
    <div id="sabores" className="flex flex-col gap-6 scroll-mt-24">
      <div className="flex flex-col items-start gap-3 text-left sm:items-center sm:text-center">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
          <span>Nuestros sabores</span>
          <span aria-hidden className="h-px w-8 bg-terracotta/40" />
        </p>
        <h2 className="font-serif text-2xl leading-tight text-cocoa sm:text-3xl">
          Elige el sabor que hará especial tu <Em>celebración</Em>
        </h2>
        <p className="text-sm leading-relaxed text-text-secondary">
          Te ayudamos a elegir la opción que mejor combine con tu
          celebración y el tipo de torta que deseas.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:gap-4">
        {FLAVORS.map((flavor) => {
          const style = FLAVOR_STYLES[flavor.value];
          return (
            <div
              key={flavor.value}
              className="flex items-center gap-3 overflow-hidden rounded-2xl border border-border-soft bg-cream-light p-2 sm:flex-col sm:items-stretch sm:gap-0 sm:p-0"
            >
              <div
                className="flex size-16 shrink-0 items-center justify-center rounded-xl sm:h-24 sm:w-full sm:rounded-none"
                style={{ backgroundColor: style.background }}
              >
                <CakeIcon className="size-7 sm:size-8" style={{ color: style.icon }} />
              </div>
              <p className="font-serif text-sm text-cocoa sm:px-3 sm:py-3 sm:text-center sm:text-base">
                {flavor.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
