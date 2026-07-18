import { describe, expect, it } from "vitest";
import { generateManageToken, hashManageToken } from "./token";

describe("generateManageToken", () => {
  it("genera un token base64url de al menos 32 bytes de aleatoriedad", () => {
    const { token } = generateManageToken();
    // 32 bytes → 43 caracteres base64url (sin relleno).
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("devuelve el hash SHA-256 en hex (64 caracteres) del token", () => {
    const { token, tokenHash } = generateManageToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashManageToken(token)).toBe(tokenHash);
  });

  it("genera tokens distintos en cada llamada", () => {
    const first = generateManageToken();
    const second = generateManageToken();
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });
});

describe("hashManageToken", () => {
  it("es determinístico (mismo token, mismo hash)", () => {
    expect(hashManageToken("un-token")).toBe(hashManageToken("un-token"));
  });

  it("un token distinto produce un hash distinto", () => {
    expect(hashManageToken("token-a")).not.toBe(hashManageToken("token-b"));
  });
});
