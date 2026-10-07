import type { PaymentMethod } from "@/lib/api/treasury";

/** O que o dono digita: percentual e reais em texto. O backend recebe basis points e centavos. */
export interface FeeForm {
  acquirer: string;
  method: PaymentMethod | "";
  ratePct: string;
  /** Reais por venda; vazio = sem taxa fixa. */
  fixedReais: string;
  /** `YYYY-MM-DD`. */
  effectiveFrom: string;
}

export interface FeePayload {
  acquirer: string;
  payment_method: PaymentMethod;
  rate_bps: number;
  fixed_cents: number;
  effective_from: string;
}

export const EMPTY_FEE_FORM: FeeForm = { acquirer: "", method: "", ratePct: "", fixedReais: "", effectiveFrom: "" };

const decimal = (text: string): number | null => {
  const value = Number(text.trim().replace(/\./g, "").replace(",", "."));

  return text.trim() === "" || !Number.isFinite(value) ? null : value;
};

/** Uma data real `YYYY-MM-DD`: 2026-02-31 não existe. */
export function isRealDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Valida e converte. Devolve TODOS os problemas de uma vez, e nada quando há algum. */
export function parseFeeForm(form: FeeForm): { ok: true; payload: FeePayload } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const acquirer = form.acquirer.trim();
  if (!acquirer) errors.push("Informe o adquirente ou a bandeira.");
  else if (acquirer.length > 80) errors.push("O adquirente tem no máximo 80 caracteres.");

  if (form.method === "") errors.push("Escolha o meio de pagamento.");

  const rate = decimal(form.ratePct);
  if (rate === null) errors.push("Informe a taxa em percentual (ex.: 1,39).");
  else if (rate < 0 || rate > 100) errors.push("A taxa deve estar entre 0% e 100%.");
  else if (Math.round(rate * 100) / 100 !== rate) errors.push("A taxa aceita no máximo duas casas decimais.");

  let fixedCents = 0;
  if (form.fixedReais.trim() !== "") {
    const fixed = decimal(form.fixedReais);
    if (fixed === null || fixed < 0) errors.push("A taxa fixa por venda deve ser um valor em reais, zero ou mais (ex.: 0,89).");
    else if (fixed > 100) errors.push("A taxa fixa por venda parece alta demais (acima de R$ 100,00).");
    else fixedCents = Math.round(fixed * 100);
  }

  if (!isRealDay(form.effectiveFrom)) errors.push("Informe uma data de início válida.");

  if (errors.length > 0 || form.method === "" || rate === null) return { ok: false, errors };

  return { ok: true, payload: { acquirer, payment_method: form.method, rate_bps: Math.round(rate * 100), fixed_cents: fixedCents, effective_from: form.effectiveFrom } };
}

/** Taxa percentual em texto, para listas e confirmações. */
export function ratePctText(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(".", ",")}%`;
}
