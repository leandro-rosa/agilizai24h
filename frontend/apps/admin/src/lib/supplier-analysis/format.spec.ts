import { describe, expect, it } from "@jest/globals";

import type { Figure } from "@/lib/api/supplier-analysis";
import { changeTone, formatChange, formatFigure, formatMonth, funnelShares, hasMovement } from "./format";

const ok = (value: number, partial?: boolean): Figure => (partial ? { available: true, value, partial } : { available: true, value });
const none = (reason: "no_purchase_history" | "never_ingested" | "no_cost" | "no_base"): Figure => ({ available: false, reason });

describe("formatFigure", () => {
  it("nunca desenha uma cifra ausente como zero", () => {
    expect(formatFigure(none("no_purchase_history"), "units")).toBe("Sem histórico de compras");
    expect(formatFigure(none("never_ingested"), "units")).toBe("Dado não importado");
    expect(formatFigure(none("no_base"), "share")).toBe("—");
    expect(formatFigure(ok(0), "units")).toBe("0 un.");
  });

  it("marca com ~ a cifra parcial e formata dinheiro e participação", () => {
    expect(formatFigure(ok(245, true), "units")).toBe("~245 un.");
    expect(formatFigure({ available: true, value: 4, estimated: true }, "units")).toBe("≈4 un.");
    expect(formatFigure(ok(842000), "cents")).toMatch(/8\.420,00/);
    expect(formatFigure(ok(0.429), "share")).toBe("42,9%");
    expect(formatFigure(ok(2.2254), "ratio")).toBe("2,23");
  });
});

describe("variações", () => {
  it("formata com sinal e devolve null quando não há comparação", () => {
    expect(formatChange(ok(0.185))).toBe("+19%");
    expect(formatChange(ok(-0.5))).toBe("-50%");
    expect(formatChange(none("no_purchase_history"))).toBeNull();
  });

  it("lê a variação pela ótica do negócio: perda maior é ruim, venda maior é boa, faixa estável é neutra", () => {
    expect(changeTone(ok(0.12), true)).toBe("positive");
    expect(changeTone(ok(0.5), false)).toBe("critical");
    expect(changeTone(ok(-0.2), false)).toBe("positive");
    expect(changeTone(ok(0.03), true)).toBe("neutral");
    expect(changeTone(ok(0.5), null)).toBe("neutral");
    expect(changeTone(none("no_base"), true)).toBe("neutral");
  });
});

describe("funnelShares", () => {
  it("usa o comprado como base quando existe", () => {
    const result = funnelShares(ok(300), ok(270), ok(245), ok(12));
    expect(result?.base).toBe("purchased");
    expect(result?.steps.map((s) => Math.round(s.share * 100))).toEqual([100, 90, 82, 4]);
  });

  it("sem compra, usa o abastecido como base e não inventa a barra de comprado", () => {
    const result = funnelShares(none("no_purchase_history"), ok(270), ok(135), ok(27));
    expect(result?.base).toBe("restocked");
    expect(result?.steps.map((s) => s.key)).toEqual(["restocked", "sold", "lost"]);
    expect(result?.steps[1].share).toBeCloseTo(0.5);
  });

  it("devolve null quando não há base", () => {
    expect(funnelShares(none("no_purchase_history"), none("never_ingested"), ok(1), ok(0))).toBeNull();
  });
});

describe("formatMonth", () => {
  it("abrevia em português", () => expect(formatMonth("2026-10")).toBe("out/2026"));
});

describe("hasMovement", () => {
  const movement = (over: Record<string, Figure> = {}) =>
    ({
      purchasedUnits: none("no_purchase_history"),
      purchasedCents: none("no_purchase_history"),
      restocked: ok(0),
      sold: ok(0),
      lost: ok(0),
      revenueCents: ok(0),
      lossCents: ok(0),
      marginShare: none("no_base"),
      avgCostCents: none("no_base"),
      ...over,
    }) as Parameters<typeof hasMovement>[0];

  it("produto com tudo zerado, ou sem dado, é parado", () => {
    expect(hasMovement(movement())).toBe(false);
    expect(hasMovement(movement({ restocked: none("never_ingested"), sold: none("never_ingested"), lost: none("never_ingested") }))).toBe(false);
  });

  it("qualquer abastecimento, venda, perda ou compra é movimento — inclusive só venda de estoque antigo", () => {
    expect(hasMovement(movement({ sold: ok(1) }))).toBe(true);
    expect(hasMovement(movement({ lost: ok(2) }))).toBe(true);
    expect(hasMovement(movement({ restocked: ok(5) }))).toBe(true);
    expect(hasMovement(movement({ purchasedUnits: ok(30) }))).toBe(true);
  });
});
