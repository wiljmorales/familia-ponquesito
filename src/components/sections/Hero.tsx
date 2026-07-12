import Image from "next/image";
import Button from "@/components/ui/Button";
import { ClockIcon, LeafIcon } from "@/components/ui/icons";
import { Em } from "@/components/ui/SectionHeading";
import { MIN_LEAD_DAYS } from "@/lib/constants/business";

const ALT_TEXT =
  "Torta blanca con topper dorado 'Happy Birthday', decorada con detalles rojos y dorados, junto a un ramo de flores y globos rosa y durazno de fondo";

export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-cream-light">
      {/* Desktop: foto a pantalla completa como fondo de toda la sección. */}
      <div className="absolute inset-0 -z-20 hidden sm:block">
        <Image
          src="/images/hero/cake-hero.jpg"
          alt={ALT_TEXT}
          fill
          sizes="100vw"
          className="object-cover object-[center_20%]"
          priority
        />
      </div>

      {/* Degradado para que el texto se lea bien sobre la foto, sin tapar
          el ramo de flores (visible entre el texto y la torta). Solo
          aplica en desktop: en mobile la foto no es fondo, va debajo. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 hidden bg-[linear-gradient(to_right,var(--cream-light)_0%,var(--cream-light)_50%,transparent_80%)] sm:block"
      />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-36 lg:px-8 lg:py-48">
        <div className="relative flex max-w-xl flex-col gap-5 sm:gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border-soft bg-cream-light/80 px-4 py-1.5 text-xs font-medium text-terracotta-dark backdrop-blur-sm">
            <LeafIcon className="size-3.5" />
            Hechas con amor
          </span>

          <h1 className="font-serif text-4xl leading-[1.15] text-cocoa sm:text-5xl lg:text-[3.25rem]">
            Creamos tortas personalizadas para celebrar{" "}
            <Em>momentos que no se repiten</Em>
          </h1>

          <p className="max-w-lg text-base leading-relaxed text-text-secondary sm:text-lg">
            Diseñamos cada torta según tu ocasión, tu estilo y tu sabor
            favorito, con atención personalizada en Barquisimeto.
          </p>

          <div>
            <Button href="#formulario" withHeart>
              Solicitar mi torta
            </Button>
          </div>

          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <ClockIcon className="size-4 text-terracotta" />
            Pedidos con al menos {MIN_LEAD_DAYS} días de anticipación.
          </p>
        </div>

        {/* Mobile: imagen contenida debajo del texto (no funciona como
            fondo a pantalla completa en pantallas angostas). */}
        <div className="relative mt-6 aspect-[4/3] w-full overflow-hidden rounded-3xl sm:hidden">
          <Image
            src="/images/hero/cake-hero.jpg"
            alt={ALT_TEXT}
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        </div>
      </div>
    </section>
  );
}
