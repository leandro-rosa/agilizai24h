import { unitCostCents } from "./taxonomy";
import { parseMoneyToCents } from "@/lib/purchases/money";

/** Como o produto é comprado: por unidade, por caixa ou por fardo. A unidade vendida é sempre UMA; o custo do produto é sempre o de UMA unidade. */
export type PurchaseMode = "unit" | "box" | "bundle";

export const PURCHASE_MODE_LABEL: Record<PurchaseMode, string> = { unit: "Unidade", box: "Caixa", bundle: "Fardo" };

/** O que o cadastro guarda de cada modo (unidade de compra do fornecedor e tipo de embalagem). */
export const PURCHASE_MODE_FIELDS: Record<PurchaseMode, { purchaseUnit: string; packageType: string | undefined }> = {
  unit: { purchaseUnit: "UN", packageType: undefined },
  box: { purchaseUnit: "CX", packageType: "caixa" },
  bundle: { purchaseUnit: "FD", packageType: "fardo" },
};

/** Concordância do rótulo: "na caixa", "no fardo"; "pela caixa", "pelo fardo". */
export const PURCHASE_MODE_ARTICLE: Record<Exclude<PurchaseMode, "unit">, { in: string; by: string }> = { box: { in: "na", by: "pela" }, bundle: { in: "no", by: "pelo" } };

export interface PurchaseCost {
  /** Custo de UMA unidade vendida, em centavos; nulo enquanto faltar valor ou quantidade válidos. */
  unitCents: number | null;
  /** O valor pago pela embalagem (ou pela unidade, no modo unidade). */
  paidCents: number | null;
  /** Unidades na embalagem: 1 no modo unidade; nulo quando a quantidade digitada não é válida. */
  units: number | null;
  /** O que o usuário precisa corrigir, em palavras; nulo quando está tudo certo (ou ainda vazio). */
  problem: string | null;
  /** A conta em uma frase ("Caixa com 12 unidades por R$ 84,00 → R$ 7,00 por unidade"); nula enquanto não há custo. */
  explanation: string | null;
  /** O custo da unidade foi arredondado ao centavo (a divisão não fechou). */
  rounded: boolean;
}

const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/\u00a0/g, " ");

/**
 * Converte "o que foi pago" em "o custo de uma unidade". Caixa com 12 unidades por R$ 84,00 → R$ 7,00. O custo da embalagem nunca é tomado como custo
 * da unidade: em caixa ou fardo a quantidade de unidades é obrigatória (2 ou mais) e, sem ela, não há custo unitário (nunca um custo errado).
 */
export function purchaseCost(mode: PurchaseMode, paidText: string, unitsText: string): PurchaseCost {
  const paid = paidText.trim() === "" ? null : parseMoneyToCents(paidText);
  const empty = { unitCents: null, paidCents: null, units: null, problem: null, explanation: null, rounded: false };
  if (paidText.trim() !== "" && (paid === null || paid <= 0)) return { ...empty, problem: "O valor informado não é válido." };

  if (mode === "unit") {
    const cents = paid !== null && paid > 0 ? paid : null;

    return { unitCents: cents, paidCents: cents, units: 1, problem: null, explanation: cents === null ? null : `${brl(cents)} por unidade`, rounded: false };
  }

  const label = PURCHASE_MODE_LABEL[mode].toLowerCase();
  const inLabel = `${PURCHASE_MODE_ARTICLE[mode].in} ${label}`;
  const units = unitsText.trim() === "" ? null : Number(unitsText);
  const validUnits = units !== null && Number.isInteger(units) && units >= 2;
  if (unitsText.trim() !== "" && !validUnits) return { ...empty, paidCents: paid, problem: `Informe quantas unidades vêm ${inLabel}: um número inteiro de 2 em diante.` };
  if (!validUnits) return { ...empty, paidCents: paid, problem: paid !== null ? `Informe quantas unidades vêm ${inLabel}.` : null };

  const unitCents = unitCostCents(paid, units);
  if (unitCents === null) return { ...empty, units, paidCents: paid };
  const exact = (paid as number) % units === 0;

  return {
    unitCents,
    paidCents: paid,
    units,
    problem: null,
    explanation: `${PURCHASE_MODE_LABEL[mode]} com ${units} unidades por ${brl(paid as number)} → ${brl(unitCents)} por unidade${exact ? "" : " (arredondado ao centavo)"}`,
    rounded: !exact,
  };
}
