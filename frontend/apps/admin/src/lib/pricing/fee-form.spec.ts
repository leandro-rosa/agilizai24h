import { describe, expect, it } from "@jest/globals";

import { isRealDay, parseFeeForm, ratePctText, type FeeForm } from "./fee-form";

const valid: FeeForm = { acquirer: "PagBank", method: "debit", ratePct: "1,39", fixedReais: "", effectiveFrom: "2026-01-01" };

describe("parseFeeForm", () => {
  it("converte percentual em basis points e reais em centavos", () => {
    expect(parseFeeForm(valid)).toEqual({ ok: true, payload: { acquirer: "PagBank", payment_method: "debit", rate_bps: 139, fixed_cents: 0, effective_from: "2026-01-01" } });
    expect(parseFeeForm({ ...valid, acquirer: " Ticket ", method: "voucher", ratePct: "5,99", fixedReais: "0,89" })).toMatchObject({ ok: true, payload: { acquirer: "Ticket", rate_bps: 599, fixed_cents: 89 } });
  });

  it("aceita zero como taxa (PIX gratuito) e taxa fixa vazia vale zero", () => {
    expect(parseFeeForm({ ...valid, ratePct: "0" })).toMatchObject({ ok: true, payload: { rate_bps: 0, fixed_cents: 0 } });
  });

  it("lista todos os problemas de uma vez", () => {
    const result = parseFeeForm({ acquirer: "", method: "", ratePct: "abc", fixedReais: "-2", effectiveFrom: "" });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toHaveLength(5);
  });

  it.each([["101"], ["-1"], ["1,234"]])("recusa a taxa %s", (ratePct) => {
    expect(parseFeeForm({ ...valid, ratePct }).ok).toBe(false);
  });

  it("recusa uma data que não existe", () => {
    expect(parseFeeForm({ ...valid, effectiveFrom: "2026-02-31" }).ok).toBe(false);
    expect(isRealDay("2026-02-28")).toBe(true);
    expect(isRealDay("26-02-28")).toBe(false);
  });

  it("recusa um adquirente longo demais e uma taxa fixa absurda", () => {
    expect(parseFeeForm({ ...valid, acquirer: "x".repeat(81) }).ok).toBe(false);
    expect(parseFeeForm({ ...valid, fixedReais: "250" }).ok).toBe(false);
  });
});

describe("ratePctText", () => {
  it("mostra o percentual com vírgula", () => {
    expect(ratePctText(139)).toBe("1,39%");
    expect(ratePctText(0)).toBe("0,00%");
  });
});
