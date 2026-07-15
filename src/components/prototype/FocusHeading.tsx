"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * h1 que recibe el foco al montarse. Las pantallas del prototipo se
 * intercambian por estado (misma URL), así que sin esto el foco de
 * teclado se quedaría en el botón que desapareció y quien usa lector de
 * pantalla no sabría que la vista cambió (mismo patrón que el StepHeading
 * del builder del Reto 3). tabIndex=-1 lo hace enfocable por código sin
 * sumarlo al orden de tabulación.
 */
export default function FocusHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <h1 ref={ref} tabIndex={-1} className={`outline-none ${className ?? ""}`}>
      {children}
    </h1>
  );
}
