import type { PricingParameters } from "@/lib/api/pricing";

/** O que o dono digita: percentuais e reais em texto. O backend guarda basis points e centavos. */
export interface RulesForm {
  targetPct: string;
  minimumPct: string;
  /** Margens por categoria, por chave do catálogo; vazio = usa a padrão. */
  categories: Record<string, { targetPct: string; minimumPct: string }>;
  roundingStepReais: string;
  psychologicalEnabled: boolean;
  psychologicalEnding: string;
  minUnitsPerMonth: string;
  minConfidence: PricingParameters["minConfidence"];
  taxRatePct: string;
  /** Uma linha por apelido: `nome_na_venda=nome_cadastrado`. */
  aliases: string;
}

const num = (text: string): number | null => {
  const value = Number(text.trim().replace(",", "."));

  return text.trim() === "" || !Number.isFinite(value) ? null : value;
};

const pct = (bps: number) => String(bps / 100).replace(".", ",");

export function toForm(params: PricingParameters): RulesForm {
  return {
    targetPct: pct(params.margin.targetBps),
    minimumPct: pct(params.margin.minimumBps),
    categories: Object.fromEntries(Object.entries(params.margin.categories).map(([key, value]) => [key, { targetPct: value.targetBps === undefined ? "" : pct(value.targetBps), minimumPct: value.minimumBps === undefined ? "" : pct(value.minimumBps) }])),
    roundingStepReais: String(params.rounding.stepCents / 100).replace(".", ","),
    psychologicalEnabled: params.psychological.enabled,
    psychologicalEnding: String(params.psychological.endingCents),
    minUnitsPerMonth: String(params.data.minUnitsPerMonth),
    minConfidence: params.minConfidence,
    taxRatePct: params.taxRateBps === null ? "" : pct(params.taxRateBps),
    aliases: Object.entries(params.payment.brandAliases).map(([from, to]) => `${from}=${to}`).join("\n"),
  };
}

export interface BuildResult {
  /** O que mudou em relação ao valor em vigor; vazio quando nada mudou. */
  patch: Record<string, unknown>;
  /** Campos que não são um número válido: nada é enviado enquanto houver algum. */
  invalid: string[];
}

export function parseAliases(text: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [from, to, ...rest] = line.split("=").map((part) => part.trim());
    if (!from || !to || rest.length > 0) return null;
    result[from.toLowerCase()] = to.toLowerCase();
  }

  return result;
}

/** Só o que mudou vira patch; o backend valida o conjunto e devolve todos os problemas de uma vez. */
export function buildPatch(form: RulesForm, current: PricingParameters): BuildResult {
  const invalid: string[] = [];
  const bpsOf = (text: string, label: string): number | null => {
    const value = num(text);
    if (value === null) {
      invalid.push(label);
      return null;
    }

    return Math.round(value * 100);
  };

  const patch: Record<string, unknown> = {};
  const group = (name: string, values: Record<string, unknown>) => {
    if (Object.keys(values).length > 0) patch[name] = { ...((patch[name] as object) ?? {}), ...values };
  };

  const target = bpsOf(form.targetPct, "Margem-alvo");
  const minimum = bpsOf(form.minimumPct, "Margem mínima");
  const margin: Record<string, unknown> = {};
  if (target !== null && target !== current.margin.targetBps) margin.targetBps = target;
  if (minimum !== null && minimum !== current.margin.minimumBps) margin.minimumBps = minimum;

  const categories: Record<string, { targetBps?: number; minimumBps?: number }> = {};
  for (const [key, value] of Object.entries(form.categories)) {
    const entry: { targetBps?: number; minimumBps?: number } = {};
    if (value.targetPct.trim() !== "") {
      const t = bpsOf(value.targetPct, `Meta de ${key}`);
      if (t !== null) entry.targetBps = t;
    }
    if (value.minimumPct.trim() !== "") {
      const m = bpsOf(value.minimumPct, `Mínima de ${key}`);
      if (m !== null) entry.minimumBps = m;
    }
    if (Object.keys(entry).length > 0) categories[key] = entry;
  }
  if (JSON.stringify(categories) !== JSON.stringify(current.margin.categories)) margin.categories = categories;
  group("margin", margin);

  const step = num(form.roundingStepReais);
  if (step === null || step <= 0) invalid.push("Arredondamento");
  else if (Math.round(step * 100) !== current.rounding.stepCents) group("rounding", { stepCents: Math.round(step * 100) });

  const psychological: Record<string, unknown> = {};
  if (form.psychologicalEnabled !== current.psychological.enabled) psychological.enabled = form.psychologicalEnabled;
  const ending = num(form.psychologicalEnding);
  if (ending === null || !Number.isInteger(ending)) invalid.push("Final do preço psicológico");
  else if (ending !== current.psychological.endingCents) psychological.endingCents = ending;
  group("psychological", psychological);

  const units = num(form.minUnitsPerMonth);
  if (units === null || !Number.isInteger(units) || units < 0) invalid.push("Quantidade mínima de vendas");
  else if (units !== current.data.minUnitsPerMonth) group("data", { minUnitsPerMonth: units });

  if (form.minConfidence !== current.minConfidence) patch.minConfidence = form.minConfidence;

  if (form.taxRatePct.trim() === "") {
    // Uma alíquota já configurada não é apagada pelo formulário: sem alíquota o motor não recomenda nada.
    if (current.taxRateBps !== null) invalid.push("Alíquota de imposto (não pode ficar vazia depois de definida)");
  } else {
    const tax = bpsOf(form.taxRatePct, "Alíquota de imposto");
    if (tax !== null && tax !== current.taxRateBps) patch.taxRateBps = tax;
  }

  const aliases = parseAliases(form.aliases);
  if (aliases === null) invalid.push("Apelidos de bandeira (use nome=nome, um por linha)");
  else if (JSON.stringify(aliases) !== JSON.stringify(current.payment.brandAliases)) group("payment", { brandAliases: aliases });

  return { patch, invalid };
}
