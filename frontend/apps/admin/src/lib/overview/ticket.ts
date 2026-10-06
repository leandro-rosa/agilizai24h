import type { SalesTransaction } from "@/lib/api/sales";
import { groupBaskets, onlyOk } from "@/lib/sales-insights";

/**
 * Ticket médio da rede num mês: faturamento ÷ número de compras (só transações `OK`). "Compra" segue a regra da tela de Vendas
 * (`groupBaskets`): linhas com o mesmo cupom na mesma loja são uma compra; linha SEM cupom conta como uma compra de um item.
 * Quando o arquivo vem sem cupom (como ago e set/2026), cada linha vira uma compra: o ticket é aproximado e `couponCoverage` diz o quanto.
 */
export interface TicketMonth {
  baskets: number;
  revenueCents: number;
  items: number;
  /** Fração das linhas OK que têm cupom (0..1). */
  couponCoverage: number;
}

export function buildTicketMonth(transactions: SalesTransaction[]): TicketMonth {
  const ok = onlyOk(transactions);
  const baskets = groupBaskets(ok);
  return {
    baskets: baskets.length,
    revenueCents: ok.reduce((s, t) => s + t.amount_paid_cents, 0),
    items: ok.reduce((s, t) => s + t.quantity, 0),
    couponCoverage: ok.length === 0 ? 0 : ok.filter((t) => !!t.coupon).length / ok.length,
  };
}

export const ticketCents = (t: TicketMonth): number | null => (t.baskets > 0 ? t.revenueCents / t.baskets : null);
