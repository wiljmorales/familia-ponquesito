import Image from "next/image";
import { Em } from "@/components/ui/SectionHeading";
import { HeartIcon } from "@/components/ui/icons";

/*
 * Desktop: dos filas de 3 fotos con anchos ligeramente distintos (estilo
 * galería "justified", como Pinterest/Google Photos). En mobile no hay
 * ancho suficiente para esa variación, así que se usa una grilla 2x3
 * uniforme (ver GALLERY_ITEMS más abajo).
 */
const ROWS = [
  [
    {
      src: "/images/gallery/chocolate-superior.jpg",
      alt: "Torta de chocolate con cobertura de ganache brillante, vista superior",
      grow: 3,
    },
    {
      src: "/images/gallery/cumpleanos-60-flores.jpg",
      alt: "Torta color crema decorada con flores y topper dorado de 'Feliz cumpleaños 60'",
      grow: 2.5,
    },
    {
      src: "/images/gallery/alana-abejitas.jpg",
      alt: "Torta amarilla decorada con tema de abejitas y topper personalizado 'Alana'",
      grow: 2,
    },
  ],
  [
    {
      src: "/images/gallery/chocolate-frontal.jpg",
      alt: "Torta de chocolate vista de frente, con cobertura de ganache",
      grow: 2.2,
    },
    {
      src: "/images/gallery/blanca-happy-birthday.jpg",
      alt: "Torta blanca con topper dorado 'Happy Birthday' sobre base dorada",
      grow: 2,
    },
    {
      src: "/images/gallery/negra-dorada-30.jpg",
      alt: "Torta de chocolate oscura con detalles dorados y velas '30', con globos de fondo",
      grow: 2.8,
    },
  ],
];

const GALLERY_ITEMS = ROWS.flat();

export default function Gallery() {
  return (
    <section id="galeria" className="border-t border-border-soft bg-cream-light py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
              <span aria-hidden>←</span>
              <span>Galería</span>
            </p>
            <h2 className="font-serif text-3xl leading-tight text-cocoa sm:text-4xl">
              Una torta para cada <Em>momento</Em> especial
            </h2>
            <p className="text-base leading-relaxed text-text-secondary">
              Cumpleaños, aniversarios y celebraciones únicas merecen una
              torta hecha especialmente para ellas.
            </p>
            <HeartIcon className="size-5 text-terracotta/60" />
          </div>

          {/* Mobile: grilla uniforme 2 columnas. */}
          <div className="grid grid-cols-2 gap-3 sm:hidden">
            {GALLERY_ITEMS.map((item) => (
              <div key={item.src} className="relative aspect-square overflow-hidden rounded-xl">
                <Image
                  src={item.src}
                  alt={item.alt}
                  fill
                  sizes="50vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>

          {/* Desktop: filas "justified" con anchos variables. */}
          <div className="hidden flex-col gap-4 sm:flex">
            {ROWS.map((row, rowIndex) => (
              <div key={rowIndex} className="flex h-56 gap-4">
                {row.map((item) => (
                  <div
                    key={item.src}
                    style={{ flexGrow: item.grow }}
                    className="relative h-full flex-1 overflow-hidden rounded-xl"
                  >
                    <Image
                      src={item.src}
                      alt={item.alt}
                      fill
                      sizes="40vw"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
