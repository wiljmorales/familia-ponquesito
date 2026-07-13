"use client";

import Image from "next/image";
import { Ban, Check } from "lucide-react";
import type { CakeImageOption } from "@/lib/cake-builder/types";

interface OptionGridProps {
  options: CakeImageOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Agrega un tile "Sin ___" al inicio (placa/topper opcionales). */
  noneLabel?: string;
}

export default function OptionGrid({ options, selectedId, onSelect, noneLabel }: OptionGridProps) {
  return (
    <div role="radiogroup" className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {noneLabel && (
        <OptionTile
          label={noneLabel}
          selected={selectedId === null}
          onClick={() => onSelect(null)}
          icon={<Ban aria-hidden className="size-6 text-text-secondary" />}
        />
      )}
      {options.map((option) => (
        <OptionTile
          key={option.id}
          label={option.label}
          selected={selectedId === option.id}
          onClick={() => onSelect(option.id)}
          image={option}
        />
      ))}
    </div>
  );
}

function OptionTile({
  label,
  selected,
  onClick,
  image,
  icon,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  image?: CakeImageOption;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex min-h-[44px] flex-col items-center gap-2 rounded-2xl border-2 p-3 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark ${
        selected
          ? "border-terracotta bg-terracotta/10"
          : "border-border-soft bg-cream-light hover:border-terracotta/50"
      }`}
    >
      <span className="relative flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
        {image ? (
          <Image
            src={image.image}
            alt=""
            fill
            sizes="80px"
            className="object-contain"
          />
        ) : (
          icon
        )}
        {selected && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-terracotta text-cream-light"
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="text-xs font-medium leading-tight text-cocoa">{label}</span>
    </button>
  );
}
