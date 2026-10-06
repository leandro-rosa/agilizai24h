/** @jest-environment node */
import { createHash } from "node:crypto";
import { sha256Bytes, sha256Hex, stableStringify } from "./content-hash";

describe("stableStringify", () => {
  it("is independent of key order", () => {
    expect(stableStringify({ a: 1, b: { d: 1, c: 2 } })).toBe(stableStringify({ b: { c: 2, d: 1 }, a: 1 }));
  });
  it("differs when content differs", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
  it("drops undefined and keeps null", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe("sha256 sem WebCrypto (contexto não seguro)", () => {
  const ref = (t: string) => createHash("sha256").update(t).digest("hex");
  const hex = (t: string) => [...sha256Bytes(new TextEncoder().encode(t))].map((b) => b.toString(16).padStart(2, "0")).join("");

  it("bate com o SHA-256 de referência, inclusive nas bordas do bloco de 64 bytes", () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const t = "aé→".repeat(Math.ceil(n / 3)).slice(0, n) + "x".repeat(n % 7);
      expect(hex(t)).toBe(ref(t));
    }
  });

  it("sha256Hex usa a alternativa quando crypto.subtle não existe", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      expect(await sha256Hex("Resumo 2026-09")).toBe(ref("Resumo 2026-09"));
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });
});
