import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const redirect = jest.fn((_to: string) => {
  throw new Error("NEXT_REDIRECT");
});
jest.doMock("next/navigation", () => ({ redirect }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Redirect: (props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) => Promise<unknown> = require("./page").default;

describe("o endereço antigo da Precificação", () => {
  beforeEach(() => jest.clearAllMocks());

  it("leva à aba Precificação da área unificada", async () => {
    await expect(Redirect({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/products?view=pricing");
  });

  it("guarda o produto aberto: ?sku= continua abrindo o mesmo produto", async () => {
    await expect(Redirect({ searchParams: Promise.resolve({ sku: "110024" }) })).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/products?view=pricing&sku=110024");
  });

  it("um sku vazio ou repetido não vira lixo na URL", async () => {
    await expect(Redirect({ searchParams: Promise.resolve({ sku: "" }) })).rejects.toThrow("NEXT_REDIRECT");
    await expect(Redirect({ searchParams: Promise.resolve({ sku: ["a", "b"] }) })).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenNthCalledWith(1, "/products?view=pricing");
    expect(redirect).toHaveBeenNthCalledWith(2, "/products?view=pricing");
  });
});
