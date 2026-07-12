import { ChatIcon, ClipboardIcon, DeliveryIcon } from "@/components/ui/icons";

const STEPS = [
  {
    icon: ChatIcon,
    title: "Cuéntanos tu idea",
    description:
      "Indica la fecha, la ocasión, el sabor y cómo imaginas tu torta.",
  },
  {
    icon: ClipboardIcon,
    title: "Recibe tu cotización",
    description:
      "Revisamos disponibilidad y te contactamos con una propuesta personalizada.",
  },
  {
    icon: DeliveryIcon,
    title: "Reserva tu pedido",
    description: "Confirma con el 50 % y comenzamos a crear tu torta.",
  },
];

function StepArrow() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 60 24"
      className="pointer-events-none absolute top-8 -right-6 hidden w-10 text-terracotta/60 sm:block"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M2 17C20 21 40 4 54 7" strokeDasharray="3 4" />
      <path d="M48 3l7 4-5 6" />
    </svg>
  );
}

/** Contenido de la columna "Cómo funciona" (sin <section> propio: se
 * combina con Flavors dentro de una sola sección en page.tsx, como en el
 * diseño). En mobile queda alineado a la izquierda y los pasos se apilan;
 * en desktop se centra y los pasos van en fila. */
export default function HowItWorks() {
  return (
    <div className="flex flex-col items-start gap-6 text-left sm:items-center sm:text-center">
      <div className="flex flex-col items-start gap-3 sm:items-center">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
          <span>Cómo funciona</span>
          <span aria-hidden className="h-px w-8 bg-terracotta/40" />
        </p>
        <h2 className="font-serif text-2xl leading-tight text-cocoa sm:text-3xl">
          Tu torta en tres pasos
        </h2>
      </div>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div
            key={step.title}
            className="relative rounded-2xl border border-border-soft bg-cream p-4 sm:p-5"
          >
            <div className="flex items-center justify-start gap-3 sm:justify-center">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-terracotta font-serif text-sm text-terracotta sm:size-10 sm:text-base">
                {index + 1}
              </span>
              <step.icon className="size-7 text-terracotta sm:size-8" />
            </div>
            <p className="mt-3 font-serif text-sm text-terracotta-dark sm:text-base">
              {index + 1}. {step.title}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-text-secondary sm:text-sm">
              {step.description}
            </p>
            {index < STEPS.length - 1 && <StepArrow />}
          </div>
        ))}
      </div>
    </div>
  );
}
