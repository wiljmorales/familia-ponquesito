"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { PrototypeScreen } from "@/types/prototype";

interface PrototypeShellProps {
  screen: PrototypeScreen;
  onBackToDashboard: () => void;
  onReset: () => void;
  children: ReactNode;
}

const HEADER_ACTION_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-cocoa transition-colors hover:text-terracotta focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark";

export default function PrototypeShell({
  screen,
  onBackToDashboard,
  onReset,
  children,
}: PrototypeShellProps) {
  const isIntro = screen === "intro";
  // En el propio dashboard "volver al centro" no aporta nada.
  const showBackToDashboard = !isIntro && screen !== "dashboard";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-cream">
      <header className="sticky top-0 z-40 border-b border-border-soft bg-cream-light/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <Image
              src="/images/logo/icon.png"
              alt="Familia Ponquesito"
              width={605}
              height={745}
              className="h-10 w-auto sm:h-12"
              priority
            />
            <span className="flex flex-col leading-none">
              <span className="font-script text-xl sm:text-2xl">
                <span className="text-cocoa">Familia </span>
                <span className="text-terracotta">Ponquesito</span>
              </span>
              <span className="text-[0.55rem] font-sans uppercase tracking-[0.25em] text-text-secondary">
                Centro de pedidos · Prototipo
              </span>
            </span>
          </div>

          <nav aria-label="Navegación del prototipo" className="flex items-center gap-1 sm:gap-2">
            {showBackToDashboard && (
              <button type="button" onClick={onBackToDashboard} className={HEADER_ACTION_CLASSES}>
                <ArrowLeft aria-hidden className="size-4" />
                <span>
                  Centro <span className="hidden sm:inline">de pedidos</span>
                </span>
              </button>
            )}
            {!isIntro && (
              <button type="button" onClick={onReset} className={HEADER_ACTION_CLASSES}>
                <RotateCcw aria-hidden className="size-4" />
                <span>
                  Reiniciar <span className="hidden sm:inline">demo</span>
                </span>
              </button>
            )}
            <Link href="/" className={HEADER_ACTION_CLASSES}>
              {/* Una sola frase que se acorta ocultando la cola: así los
                  lectores de pantalla no leen dos labels concatenados. */}
              <span>
                Ir al sitio<span className="hidden sm:inline"> principal</span>
              </span>
            </Link>
          </nav>
        </div>

        <p className="border-t border-gold/30 bg-gold/15 py-1 text-center text-xs text-cocoa">
          Datos de demostración — nada de lo que hagas aquí se envía de verdad.
        </p>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>

      <footer className="border-t border-border-soft bg-cream-light">
        <p className="mx-auto max-w-6xl px-4 py-4 text-center text-xs text-text-secondary">
          Prototipo del Centro de pedidos · Familia Ponquesito ·{" "}
          <Link
            href="/"
            className="underline underline-offset-2 transition-colors hover:text-terracotta"
          >
            Volver al sitio principal
          </Link>
        </p>
      </footer>
    </div>
  );
}
