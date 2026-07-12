import Image from "next/image";
import { LocationIcon } from "@/components/ui/icons";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/lib/constants/business";

/*
 * lucide-react ya no incluye logos de marcas (Instagram) por temas de
 * marca registrada, así que se dibuja como SVG propio.
 */
function InstagramIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-border-soft bg-cream">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-6 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Image
            src="/images/logo/icon-on-cream.png"
            alt="Familia Ponquesito"
            width={612}
            height={749}
            className="h-14 w-auto"
          />
          <div className="flex flex-col leading-none">
            <span className="font-script text-2xl">
              <span className="text-cocoa">Familia </span>
              <span className="text-terracotta">Ponquesito</span>
            </span>
            <span className="mt-1 text-[0.55rem] uppercase tracking-[0.25em] text-text-secondary">
              Hecho con amor, para compartir
            </span>
          </div>
        </div>

        <span className="flex items-center gap-1.5 text-sm text-text-secondary">
          <LocationIcon className="size-4" />
          Barquisimeto
        </span>

        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Instagram de Familia Ponquesito (${INSTAGRAM_HANDLE})`}
          className="flex items-center gap-1.5 text-sm text-cocoa transition-colors hover:text-terracotta"
        >
          <InstagramIcon />
          Instagram
        </a>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-6 sm:px-6 lg:px-8">
        <p className="text-center text-xs leading-relaxed text-text-secondary">
          Tus datos se usan únicamente para gestionar tu solicitud de
          cotización y contactarte por ese motivo. No los compartimos con
          terceros.
        </p>
      </div>
    </footer>
  );
}
