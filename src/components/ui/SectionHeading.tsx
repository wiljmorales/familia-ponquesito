import type { ReactNode } from "react";

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  id?: string;
}

export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  id,
}: SectionHeadingProps) {
  const alignClasses =
    align === "center" ? "items-center text-center mx-auto" : "items-start text-left";

  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${alignClasses}`}>
      {eyebrow && (
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
          <span aria-hidden>•</span>
          <span>{eyebrow}</span>
          <span aria-hidden>•</span>
        </p>
      )}
      <h2 id={id} className="font-serif text-3xl leading-tight text-cocoa sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="text-base leading-relaxed text-text-secondary sm:text-lg">
          {description}
        </p>
      )}
    </div>
  );
}

/** Palabra o frase emotiva resaltada dentro de un título (serif itálica terracota). */
export function Em({ children }: { children: ReactNode }) {
  return <em className="font-serif text-terracotta italic">{children}</em>;
}
