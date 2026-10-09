import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORDER_WHATSAPP_MESSAGE } from "@/lib/constants/business";
import { buildWhatsappMessageUrl } from "@/lib/utils/whatsapp";

/*
 * El WhatsApp oficial vive en varios sitios que nadie compila juntos: el HTML
 * estático de /linktree (impreso en QR), la variable pública del build de
 * staging, el ejemplo de entorno y la base de conocimiento del asistente.
 * Esta prueba falla si alguno diverge del botón de /linktree.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

function envValue(file: string, name: string): string | undefined {
  const lines = read(file).split("\n").filter((l) => l.startsWith(`${name}=`));
  return lines.at(-1)?.slice(name.length + 1);
}

const linktree = read("public/linktree.html");
const waLinks = [...linktree.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map((m) => m[1]);
const linktreeUrl = new URL(waLinks[0] ?? "https://invalid.example");
const linktreeDigits = linktreeUrl.pathname.slice(1);
const officialBase = `https://wa.me/${linktreeDigits}`;

describe("WhatsApp oficial", () => {
  it("/linktree tiene un solo enlace de WhatsApp, con número y el mensaje de pedido", () => {
    expect(waLinks).toHaveLength(1);
    expect(linktreeDigits).toMatch(/^58\d{10}$/);
    expect(linktreeUrl.searchParams.getAll("text")).toEqual([ORDER_WHATSAPP_MESSAGE]);
  });

  it("el número visible de /linktree es el del enlace", () => {
    const visible = linktree.match(/<small>(\+58 [\d-]+)<\/small>/)?.[1] ?? "";
    expect(visible.replace(/\D/g, "")).toBe(linktreeDigits);
  });

  it.each(["deploy/web/staging.build.env", ".env.example"])(
    "NEXT_PUBLIC_WHATSAPP_URL de %s es la base del botón de /linktree",
    (file) => {
      expect(envValue(file, "NEXT_PUBLIC_WHATSAPP_URL")).toBe(officialBase);
    },
  );

  it("la base de conocimiento lo reconoce como canal oficial", () => {
    expect(read("src/knowledge/familia-ponquesito.md")).toContain(`(${officialBase})`);
  });

  it("buildWhatsappMessageUrl sobre la base oficial agrega exactamente un mensaje", () => {
    const url = new URL(buildWhatsappMessageUrl(officialBase, ORDER_WHATSAPP_MESSAGE));
    expect(url.href.split("?")).toHaveLength(2);
    expect(url.searchParams.getAll("text")).toEqual([ORDER_WHATSAPP_MESSAGE]);
    // El footer enlaza exactamente lo mismo que el botón de /linktree.
    expect(url.href).toBe(linktreeUrl.href);
  });
});
