"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { HeartIcon } from "@/components/ui/icons";

type PrototypeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: "primary" | "outline";
  size?: "md" | "sm";
  withHeart?: boolean;
};

/**
 * Botón propio del prototipo en lugar de ui/Button: el anillo de foco del
 * componente compartido hereda currentColor, que en el variant primario es
 * crema sobre fondo crema (imperceptible con teclado). Aquí el foco usa un
 * ring terracota oscuro, visible sobre crema, blanco y terracota. No se
 * cambia el contrato del componente global solo por este reto (decisión
 * documentada en docs/challenge-5.md).
 */
const BASE_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta-dark focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:cursor-not-allowed disabled:opacity-60";

const VARIANT_CLASSES: Record<NonNullable<PrototypeButtonProps["variant"]>, string> = {
  primary: "bg-terracotta text-cream-light hover:bg-terracotta-dark",
  outline: "border border-terracotta bg-transparent text-terracotta-dark hover:bg-terracotta/10",
};

const SIZE_CLASSES: Record<NonNullable<PrototypeButtonProps["size"]>, string> = {
  md: "px-6 py-3",
  sm: "px-4 py-1.5",
};

export default function PrototypeButton({
  children,
  variant = "primary",
  size = "md",
  withHeart = false,
  className,
  ...rest
}: PrototypeButtonProps) {
  return (
    <button
      className={`${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className ?? ""}`}
      {...rest}
    >
      {children}
      {withHeart && <HeartIcon aria-hidden className="size-4" />}
    </button>
  );
}
