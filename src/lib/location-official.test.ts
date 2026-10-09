import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { temporaryProvider } from "@/assistant/temporary-provider";
import { BUSINESS_ADDRESS, BUSINESS_ADDRESS_TEXT } from "@/lib/constants/business";

/*
 * La dirección del local vive en el HTML estático de /linktree (impreso en
 * QR), en BUSINESS_ADDRESS y en la base de conocimiento del asistente. Esta
 * prueba falla si divergen o si vuelve el dato obsoleto de julio de 2026
 * ("no hay local físico").
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const flat = (text: string) => text.replace(/\s+/g, " ");

const linktree = read("public/linktree.html");
const knowledge = flat(read("src/knowledge/familia-ponquesito.md"));

describe("Local físico oficial", () => {
  it("el destino de Google Maps de /linktree es BUSINESS_ADDRESS_TEXT", () => {
    const href = linktree.match(/href="(https:\/\/www\.google\.com\/maps\/[^"]*)"/)?.[1] ?? "";
    const query = new URL(href.replaceAll("&amp;", "&")).searchParams.get("query");
    expect(query).toBe(BUSINESS_ADDRESS_TEXT);
  });

  it("la dirección visible de /linktree es la de BUSINESS_ADDRESS", () => {
    const address = flat(linktree.match(/<address>([\s\S]*?)<\/address>/)?.[1] ?? "")
      .replace(/<br\s*\/?>/g, " ")
      .toLowerCase();
    for (const part of [BUSINESS_ADDRESS.street, BUSINESS_ADDRESS.reference, BUSINESS_ADDRESS.city]) {
      expect(address).toContain(part.toLowerCase());
    }
  });

  it("la base de conocimiento da la dirección como vigente", () => {
    expect(knowledge).toContain(BUSINESS_ADDRESS_TEXT);
    expect(knowledge).toMatch(/¿Tienen local físico\?\*\* Sí, en la Carrera 19/);
  });

  it("la base de conocimiento no da como vigente el dato obsoleto", () => {
    expect(knowledge).not.toMatch(/No hay local físico/i);
    expect(knowledge).not.toMatch(/opera desde Las Trinitarias/i);
    expect(knowledge).not.toMatch(/no dar direcciones exactas/i);
  });

  it.each(["¿Dónde están ubicados?", "¿Tienen local físico?", "¿Cuál es la dirección?", "¿Cómo llego?"])(
    "el asistente determinista responde %s con la dirección",
    async (message) => {
      const result = await temporaryProvider({ message });
      expect(result.status).toBe("answered");
      expect(result.reply).toContain(BUSINESS_ADDRESS.street);
      expect(result.reply).toContain(BUSINESS_ADDRESS.reference);
      expect(result.reply).toContain(BUSINESS_ADDRESS.city);
    },
  );

  it("el asistente determinista no amplía lo que sabe", async () => {
    expect((await temporaryProvider({ message: "¿Dónde puedo hacer un pedido?" })).status).toBe(
      "human_required",
    );
    expect((await temporaryProvider({ message: "¿Cuánto cuesta una torta?" })).status).toBe("unknown");
    expect((await temporaryProvider({ message: "¿Dónde puedo pagar?" })).status).toBe("unknown");
  });
});

describe("Sin contactos de ejemplo en la interfaz", () => {
  const files = readdirSync(path.join(process.cwd(), "src"), { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => path.join("src", f));

  it("ningún componente muestra correos de ejemplo", () => {
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => /[\w.+-]+@(ejemplo|example)\.(com|org|net)/i.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
