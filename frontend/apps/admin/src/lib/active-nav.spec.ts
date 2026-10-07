import { describe, expect, it } from "@jest/globals";

import { activeHref } from "./active-nav";

const HREFS = ["/", "/purchases", "/purchases/orders", "/purchases/settlements", "/inventory", "/inventory/central", "/products"];

describe("activeHref", () => {
  it("escolhe o item mais específico em vez de acender o pai também", () => {
    expect(activeHref("/purchases/settlements", HREFS)).toBe("/purchases/settlements");
    expect(activeHref("/purchases", HREFS)).toBe("/purchases");
    expect(activeHref("/inventory/central", HREFS)).toBe("/inventory/central");
    expect(activeHref("/inventory", HREFS)).toBe("/inventory");
  });

  it("aceita sub-rotas que não estão no menu e compara por segmento", () => {
    expect(activeHref("/purchases/orders/12", HREFS)).toBe("/purchases/orders");
    expect(activeHref("/products-old", HREFS)).toBeNull();
    expect(activeHref("/", HREFS)).toBe("/");
    expect(activeHref("/nada", HREFS)).toBeNull();
  });
});

describe("precificação e taxas", () => {
  const hrefs = ["/purchases", "/purchases/pricing", "/treasury", "/treasury/fees"];

  it("a precificação acende o próprio item, não Compras e Fornecedores", () => {
    expect(activeHref("/purchases/pricing", hrefs)).toBe("/purchases/pricing");
    expect(activeHref("/purchases", hrefs)).toBe("/purchases");
  });

  it("as taxas acendem o próprio item, não Lançamentos", () => {
    expect(activeHref("/treasury/fees", hrefs)).toBe("/treasury/fees");
  });
});
