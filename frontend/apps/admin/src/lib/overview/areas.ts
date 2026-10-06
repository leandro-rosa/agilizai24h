import { reasonLabel } from "../removal-reasons";
import { friendlyMoney, moreOrLess, plainify } from "./plain";
import { OVERDUE } from "./overdue";
import { priceImpactReading } from "./price-volume";
import type { Overview } from "./types";

/** Uma pergunta que a pessoa daquela área pode se fazer, com o que os dados já mostram. Nunca uma ordem nem uma causa. */
export interface AreaQuestion {
  question: string;
  answer: string;
}

export interface Areas {
  socios: AreaQuestion[];
  operacao: AreaQuestion[];
  financeiro: AreaQuestion[];
}

export const AREA_MAX = 3;
export const AREA_EMPTY = "Nada fora do normal com os dados disponíveis.";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const clean = (q: AreaQuestion | null): q is AreaQuestion => q !== null;

export function buildAreaQuestions(o: Overview): Areas {
  // Sócios: o quadro geral — reajuste, concentração por loja e o maior ponto de atenção.
  const socios = [
    o.priceChanges ? { question: "Os reajustes de preço valeram a pena?", answer: priceImpactReading(o.priceChanges, friendlyMoney).verdict.title + "." } : null,
    o.stores && o.stores.growthExplainers.stores.length
      ? {
          question: "O crescimento veio de poucas lojas?",
          answer: `${plural(o.stores.growthExplainers.stores.length, "loja explica", "lojas explicam")} ${pct(o.stores.growthExplainers.coveredShare)} do aumento nas vendas, de ${o.stores.growthExplainers.storeCount} que ${o.stores.growthExplainers.storeCount === 1 ? "cresceu" : "cresceram"}: ${o.stores.growthExplainers.stores.slice(0, 3).map((s) => s.name).join(", ")}.`,
        }
      : null,
    o.stores && o.stores.declineExplainers.stores.length
      ? {
          question: "A queda veio de poucas lojas?",
          answer: `${plural(o.stores.declineExplainers.stores.length, "loja explica", "lojas explicam")} ${pct(o.stores.declineExplainers.coveredShare)} da queda nas vendas: ${o.stores.declineExplainers.stores.slice(0, 3).map((s) => s.name).join(", ")}.`,
        }
      : null,
    o.highlights.attention ? { question: "Qual é o maior ponto de atenção do mês?", answer: `${o.highlights.attention.title}.` } : null,
  ].filter(clean);

  // Operação: perdas, testes, lojas e a confiança da contagem de estoque.
  const topReason = o.loss?.byReason[0];
  const tests = o.tests?.rows ?? [];
  const attentionTests = tests.filter((t) => t.signal === "atencao").length;
  const storeAttention = o.stores?.attention[0];
  const operacao = [
    topReason && topReason.valueCents > 0
      ? { question: "Qual foi o maior motivo de produtos perdidos?", answer: `${reasonLabel(topReason.reason)}: ${friendlyMoney(topReason.valueCents)}${topReason.share !== null ? ` (${pct(topReason.share)} do total perdido)` : ""}. Vale olhar o abastecimento dessas lojas?` }
      : null,
    storeAttention ? { question: "Alguma loja pede um olhar?", answer: `${storeAttention.name}: ${storeAttention.reasons.join("; ")}.` } : null,
    tests.length > 0
      ? {
          question: "Os produtos em teste já dão para avaliar?",
          answer: `${plural(tests.length, "produto está", "produtos estão")} em teste; ${attentionTests > 0 ? `${plural(attentionTests, "pede", "pedem")} atenção` : "nenhum pede atenção"} e os demais ainda precisam de mais tempo de venda.`,
        }
      : null,
    o.loss && o.loss.incompleteStores > 0
      ? { question: "A contagem de estoque é confiável?", answer: `${plural(o.loss.incompleteStores, "loja tem", "lojas têm")} contagem com falhas; as perdas podem estar maiores do que o mostrado.` }
      : null,
  ].filter(clean);

  // Financeiro: dinheiro no banco, notas vencidas e para onde o dinheiro foi.
  const topUse = o.cashUses?.lines[0];
  const od = o.cash.overdueDetail;
  const financeiro = [
    o.cash.opening !== null && o.cash.closing !== null
      ? {
          question: "O dinheiro no banco subiu ou caiu?",
          answer: `${o.cash.closing >= o.cash.opening ? "Subiu" : "Caiu"} ${friendlyMoney(Math.abs(o.cash.closing - o.cash.opening))}, de ${friendlyMoney(o.cash.opening)} para ${friendlyMoney(o.cash.closing)}${o.cash.operatingPositiveCashFell ? ", mesmo com lucro positivo na operação" : ""}.`,
        }
      : null,
    od
      ? {
          question: "Há notas vencidas e ainda não pagas?",
          answer:
            od.long.count > 0
              ? `${plural(od.long.count, "nota vencida", "notas vencidas")} há mais de ${OVERDUE.SHORT_DAYS} dias (${friendlyMoney(od.long.cents)}).`
              : `${friendlyMoney(od.short.cents)} venceram há poucos dias (até ${od.maxDaysOverdue}). Em geral é pagamento já feito e ainda não baixado.`,
        }
      : null,
    topUse
      ? { question: "Para onde foi mais dinheiro?", answer: `${plainify(topUse.label)}: ${friendlyMoney(topUse.currentCents)}${topUse.shareOfOutflow !== null ? ` (${pct(topUse.shareOfOutflow)} das saídas)` : ""}${topUse.previousCents !== null ? `, ${moreOrLess(topUse.currentCents - topUse.previousCents)} que no mês anterior` : ""}.` }
      : null,
  ].filter(clean);

  return { socios: socios.slice(0, AREA_MAX), operacao: operacao.slice(0, AREA_MAX), financeiro: financeiro.slice(0, AREA_MAX) };
}
