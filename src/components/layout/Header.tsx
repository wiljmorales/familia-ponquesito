"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import Button from "@/components/ui/Button";

const NAV_LINKS = [
  { href: "#galeria", label: "Galería" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#sabores", label: "Sabores" },
  { href: "/agenda", label: "Reserva tu fecha" },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-border-soft bg-cream-light/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <Image
            src="/images/logo/icon.png"
            alt="Familia Ponquesito"
            width={605}
            height={745}
            className="h-14 w-auto sm:h-16"
            priority
          />
          <span className="flex flex-col leading-none">
            <span className="font-script text-2xl sm:text-3xl">
              <span className="text-cocoa">Familia </span>
              <span className="text-terracotta">Ponquesito</span>
            </span>
            <span className="text-[0.55rem] font-sans uppercase tracking-[0.25em] text-text-secondary">
              Hecho con amor, para compartir
            </span>
          </span>
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-cocoa transition-colors hover:text-terracotta"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button href="#formulario" withHeart>
            Solicitar mi torta
          </Button>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-10 items-center justify-center rounded-full text-cocoa focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracotta-dark md:hidden"
        >
          {open ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
      </div>

      {open && (
        <div
          id="mobile-menu"
          className="border-t border-border-soft bg-cream-light px-4 pb-6 pt-4 md:hidden"
        >
          <nav aria-label="Principal móvil" className="flex flex-col gap-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="text-base font-medium text-cocoa transition-colors hover:text-terracotta"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-5">
            <Button href="#formulario" withHeart className="w-full" onClick={() => setOpen(false)}>
              Solicitar mi torta
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
