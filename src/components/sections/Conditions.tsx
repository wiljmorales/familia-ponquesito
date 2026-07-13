import {
  CalendarIcon,
  ClockIcon,
  DeliveryIcon,
  LocationIcon,
  NoSameDayIcon,
  OrderBoxIcon,
  PercentageIcon,
} from "@/components/ui/icons";
import { CONDITIONS } from "@/lib/constants/business";

const ICONS = [
  CalendarIcon,
  NoSameDayIcon,
  PercentageIcon,
  DeliveryIcon,
  OrderBoxIcon,
  ClockIcon,
  LocationIcon,
];

export default function Conditions() {
  return (
    <section className="border-y border-border-soft bg-cream py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <p className="mb-8 flex items-center justify-center gap-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
          <span aria-hidden>•</span>
          Todo claro desde el principio
          <span aria-hidden>•</span>
        </p>

        <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-7 lg:gap-4">
          {CONDITIONS.map((condition, index) => {
            const Icon = ICONS[index];
            return (
              <li key={condition.label} className="flex flex-col items-center gap-2 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-terracotta/10 text-terracotta">
                  <Icon className="size-5" />
                </span>
                <p className="text-xs leading-snug text-text-secondary">{condition.label}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
