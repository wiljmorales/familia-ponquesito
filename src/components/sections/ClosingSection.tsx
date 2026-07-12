import Image from "next/image";
import { HeartIcon } from "@/components/ui/icons";
import { SLOGAN } from "@/lib/constants/business";

const [SLOGAN_LINE_1, SLOGAN_LINE_2] = SLOGAN.split(", ");
const ALT_TEXT =
  "Torta blanca con flores prensadas sobre un mantel de tela clara, ambiente cálido y desenfocado";

export default function ClosingSection() {
  return (
    <section className="relative isolate overflow-hidden border-t border-border-soft bg-cream-light">
      {/* Desktop: foto a pantalla completa como fondo, igual que el hero. */}
      <div className="absolute inset-0 -z-10 hidden sm:block">
        <Image src="/images/closing/closing-bg.jpg" alt={ALT_TEXT} fill sizes="100vw" className="object-cover" />
      </div>

      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
          <div className="mx-auto flex w-fit flex-col items-center gap-3 text-center lg:mx-0">
            <p className="font-script text-4xl font-bold leading-[1.05] text-terracotta sm:text-6xl lg:text-7xl">
              <span className="block">{SLOGAN_LINE_1},</span>
              <span className="block">{SLOGAN_LINE_2}</span>
            </p>
            <div className="flex w-full items-center gap-2 text-terracotta/50">
              <span aria-hidden className="h-px flex-1 bg-current" />
              <HeartIcon className="size-4 shrink-0" />
              <span aria-hidden className="h-px flex-1 bg-current" />
            </div>
          </div>

          <p className="mx-auto max-w-md text-base leading-relaxed text-text-secondary sm:text-lg lg:mx-0 lg:pt-2 lg:text-xl">
            Cada celebración merece algo especial. En Familia Ponquesito
            creamos tortas pensadas para acompañar tus mejores momentos.
          </p>
        </div>
      </div>
    </section>
  );
}
