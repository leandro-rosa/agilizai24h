import { newUuid } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newUuid", () => {
  const original = crypto.randomUUID;
  afterEach(() => {
    Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
  });

  it("gera um UUID v4 mesmo sem crypto.randomUUID (contexto não seguro)", () => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    const a = newUuid();
    expect(a).toMatch(V4);
    expect(newUuid()).not.toBe(a);
  });
});
