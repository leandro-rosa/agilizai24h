import type { OperatingAccount, OperatingClass, OperatingReport, PricingReportMeta } from "@/lib/api/pricing";

/** Um relatório guardado antes do `pricing-4` traz só `{ share, months, accounts }`: sem classes, nada a validar nem a classificar. */
export function isClassified(operating: PricingReportMeta["operating"]): operating is OperatingReport {
  return operating !== null && "classes" in operating;
}

export interface ClassifiableAccount extends OperatingAccount {
  /** Classe com que a conta entrou no cálculo; `null` = sem classificação. */
  class: OperatingClass | null;
  /** Imposto, taxas, perda e compras já são componentes do preço: a classe é fixa e não se escolhe. */
  locked: boolean;
}

/** As despesas que o relatório leu, cada uma com a classe atual: as sem classe primeiro, que são o que impede a validação. */
export function classifiableAccounts(operating: PricingReportMeta["operating"]): ClassifiableAccount[] {
  if (!isClassified(operating)) return [];

  const rows: ClassifiableAccount[] = operating.unclassified.map((account) => ({ ...account, class: null, locked: false }));
  for (const [name, total] of Object.entries(operating.classes) as [OperatingClass, OperatingReport["classes"][OperatingClass]][]) {
    for (const account of total.accounts) rows.push({ ...account, class: name, locked: name === "already_component" });
  }

  return rows;
}

const reais = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** O aviso de "cálculo incompleto": o valor, o período e o escopo das despesas sem tratamento, nunca só a frase. */
export function incompleteSummary(operating: PricingReportMeta["operating"]): string | null {
  if (!isClassified(operating) || operating.complete) return null;
  if (operating.unclassified.length === 0) return "Cálculo incompleto: o custo por transação não pôde ser distribuído por unidade (sem tickets ou unidades no período).";

  const months = operating.months.join(", ");
  const list = operating.unclassified.map((account) => `${account.code} ${account.label} (${reais(account.amountCents)})`).join("; ");

  return `Cálculo incompleto: ${reais(operating.unclassifiedCents)} em despesas sem classificação (${(operating.unclassifiedShare * 100).toFixed(2).replace(".", ",")}% da receita de vendas das lojas; escopo: ${operating.scope}; meses: ${months}): ${list}. Nenhuma recomendação está validada até elas serem classificadas.`;
}
