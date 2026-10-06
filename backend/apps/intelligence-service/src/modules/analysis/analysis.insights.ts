import type { Parameters } from '../parameters/parameters.types'
import type { CompareTo, Figure, Insight, Movement, ProductLine, StoreRow, Variation } from './analysis.types'

/** Each already carries its preposition ("ao", "à"), so a sentence reads "em relação ${ref}". */
const REFERENCE_TEXT: Record<CompareTo, string> = { prev_month: 'ao mês anterior', avg_3m: 'à média dos 3 meses anteriores' }

const value = (f: Figure): number | null => (f.available ? f.value : null)
const pct = (share: number): string => `${Math.round(Math.abs(share) * 100)}%`
const units = (n: number): string => `${Math.round(n).toLocaleString('pt-BR')} un.`
const direction = (change: number, stable: number): 'up' | 'down' | 'stable' => (Math.abs(change) <= stable ? 'stable' : change > 0 ? 'up' : 'down')

function change(v: Variation): number | null {
  return v.change.available ? v.change.value : null
}

export interface SupplierInsightInput {
  movement: Movement
  comparison: Record<keyof Movement, Variation>
  products: ProductLine[]
  /** Products whose margin is below the attention threshold. */
  lowMargin?: ProductLine[]
  /** Lost ÷ restocked over the whole network that month, or null when unknown. */
  networkLossShare: number | null
  storesRestocked: number
  compareTo: CompareTo
  /** How the comparison period is named in a sentence; defaults from `compareTo`. A multi-month range names its own. */
  referenceText?: string
  p: Parameters['analysis']
}

/**
 * Every insight relates figures and carries the evidence it used. An insight that
 * needs a figure that is unavailable (purchases, today) is not generated at all.
 */
export function supplierInsights(i: SupplierInsightInput): Insight[] {
  const out: Insight[] = []
  const ref = i.referenceText ?? REFERENCE_TEXT[i.compareTo]
  const bought = value(i.movement.purchasedUnits)
  const restocked = value(i.movement.restocked)
  const sold = value(i.movement.sold)
  const lost = value(i.movement.lost)
  const boughtChange = change(i.comparison.purchasedUnits)
  const soldChange = change(i.comparison.sold)
  const lostChange = change(i.comparison.lost)

  if (boughtChange !== null && soldChange !== null && boughtChange > soldChange + i.p.stableVariationShare && boughtChange > i.p.stableVariationShare) {
    out.push({
      kind: 'purchases_outpace_sales',
      label: 'MÉTRICA DERIVADA',
      tone: 'attention',
      text: `As compras ${boughtChange > 0 ? 'aumentaram' : 'caíram'} ${pct(boughtChange)}, mas as vendas ${soldChange >= 0 ? 'aumentaram' : 'caíram'} apenas ${pct(soldChange)}, em relação ${ref}.`,
      evidence: { figures: { purchasedChange: boughtChange, soldChange }, formula: '(atual − referência) ÷ referência, para compras e vendas em unidades', reference: ref },
    })
  } else if (boughtChange !== null && direction(boughtChange, i.p.stableVariationShare) !== 'stable') {
    out.push({
      kind: 'purchases_change',
      label: 'MÉTRICA DERIVADA',
      tone: 'info',
      text: `Compras deste fornecedor ${boughtChange > 0 ? 'aumentaram' : 'caíram'} ${pct(boughtChange)} em relação ${ref}.`,
      evidence: { figures: { purchasedChange: boughtChange }, formula: '(atual − referência) ÷ referência', reference: ref },
    })
  }

  if (bought !== null && restocked !== null && bought > 0 && bought > restocked) {
    const share = (bought - restocked) / bought
    out.push({
      kind: 'purchased_not_restocked',
      label: 'MÉTRICA DERIVADA',
      tone: share >= 0.3 ? 'attention' : 'info',
      text: `${pct(share)} das unidades compradas ainda não foram abastecidas.`,
      evidence: { figures: { purchased: bought, restocked, notRestocked: bought - restocked }, formula: '(comprado − abastecido) ÷ comprado' },
    })
  }

  const bonus = value(i.movement.bonusUnits)
  if (bonus !== null && bonus > 0) {
    out.push({
      kind: 'bonus_received',
      label: 'FATO',
      tone: 'info',
      text: `Foram recebidas ${units(bonus)} como bonificação neste período: não entram no gasto, na margem nem no markup.`,
      evidence: { figures: { bonusUnits: bonus } },
    })
  }

  if (sold !== null && soldChange !== null && direction(soldChange, i.p.stableVariationShare) !== 'stable') {
    out.push({
      kind: 'sales_change',
      label: 'FATO',
      tone: soldChange > 0 ? 'positive' : 'attention',
      text: `As vendas dos produtos deste fornecedor ${soldChange > 0 ? 'cresceram' : 'caíram'} ${pct(soldChange)} em relação ${ref}.`,
      evidence: { figures: { sold, soldChange }, formula: '(vendido atual − referência) ÷ referência', reference: ref },
    })
  }

  if (lost !== null && lostChange !== null && lostChange > i.p.stableVariationShare) {
    out.push({
      kind: 'loss_up',
      label: 'FATO',
      tone: 'critical',
      text: `A perda aumentou ${pct(lostChange)} em relação ${ref}: ${units(lost)}`,
      evidence: { figures: { lost, lostChange }, formula: '(perdido atual − referência) ÷ referência', reference: ref },
    })
  }

  if (i.networkLossShare !== null) {
    const above = i.products.filter(line => {
      const l = value(line.movement.lost)
      const r = value(line.movement.restocked)
      return l !== null && r !== null && r >= i.p.minRestockedForSituation && l / r > i.networkLossShare! * i.p.lossAboveNetworkFactor
    })
    if (above.length > 0) {
      out.push({
        kind: 'products_loss_above_network',
        label: 'MÉTRICA DERIVADA',
        tone: 'attention',
        text: `O fornecedor possui ${above.length} ${above.length === 1 ? 'produto' : 'produtos'} com perda acima da média da operação: ${above
          .slice(0, 3)
          .map(l => l.name)
          .join(', ')}${above.length > 3 ? '…' : ''}.`,
        evidence: {
          figures: { networkLossShare: i.networkLossShare, factor: i.p.lossAboveNetworkFactor, products: above.length },
          formula: 'perdido ÷ abastecido do produto > perda da rede × fator',
          reference: 'média da rede no mês',
        },
      })
    }
  }

  const low = i.lowMargin ?? []
  if (low.length > 0) {
    const share = (line: ProductLine) => (line.movement.marginShare.available ? line.movement.marginShare.value : 0)
    const worst = [...low].sort((a, b) => share(a) - share(b)).slice(0, 3)
    out.push({
      kind: 'low_margin_products',
      label: 'MÉTRICA DERIVADA',
      tone: 'attention',
      text: `${low.length} ${low.length === 1 ? 'produto tem' : 'produtos têm'} margem bruta abaixo de ${pct(i.p.attentionMargin)}: ${worst.map(l => `${l.name} (${pct(share(l))})`).join(', ')}${low.length > 3 ? '…' : ''}.`,
      evidence: {
        figures: { products: low.length, threshold: i.p.attentionMargin, ...Object.fromEntries(worst.map(l => [l.name, share(l)])) },
        formula: '(receita − custo do vendido) ÷ receita do produto, abaixo do corte de atenção',
        reference: 'só produtos com custo cadastrado',
      },
    })
  }

  const totalRevenue = i.products.reduce((s, l) => s + (value(l.movement.revenueCents) ?? 0), 0)
  const top = [...i.products].sort((a, b) => (value(b.movement.revenueCents) ?? 0) - (value(a.movement.revenueCents) ?? 0))[0]
  if (top && totalRevenue > 0) {
    const share = (value(top.movement.revenueCents) ?? 0) / totalRevenue
    if (share >= i.p.concentrationShare) {
      out.push({
        kind: 'concentration',
        label: 'MÉTRICA DERIVADA',
        tone: 'info',
        text: `${top.name} representa ${pct(share)} da receita deste fornecedor (base: receita, não valor comprado${bought === null ? ', que não tem histórico' : ''}).`,
        evidence: { figures: { productRevenueCents: value(top.movement.revenueCents) ?? 0, supplierRevenueCents: totalRevenue }, formula: 'receita do produto ÷ receita do fornecedor' },
      })
    }
  }

  if (i.storesRestocked > 0) {
    out.push({
      kind: 'stores_restocked',
      label: 'FATO',
      tone: 'info',
      text: `Os produtos deste fornecedor foram abastecidos em ${i.storesRestocked} ${i.storesRestocked === 1 ? 'loja' : 'lojas'}.`,
      evidence: { figures: { stores: i.storesRestocked } },
    })
  }

  return out
}

export interface ProductInsightInput {
  movement: Movement
  comparison: Record<keyof Movement, Variation>
  stores: StoreRow[]
  compareTo: CompareTo
  referenceText?: string
  p: Parameters['analysis']
  networkLossShare: number | null
}

export function productInsights(i: ProductInsightInput): Insight[] {
  const out: Insight[] = []
  const bought = value(i.movement.purchasedUnits)
  const restocked = value(i.movement.restocked)
  const sold = value(i.movement.sold)
  const lost = value(i.movement.lost)

  if (restocked !== null && sold !== null && lost !== null) {
    const text =
      bought !== null
        ? `Foram compradas ${units(bought)} e abastecidas ${units(restocked)}. Das abastecidas, ${units(sold)} foram vendidas e ${units(lost)} perdidas.`
        : `Foram abastecidas ${units(restocked)}: ${units(sold)} vendidas e ${units(lost)} perdidas (sem histórico de compras neste período).`
    out.push({
      kind: 'funnel',
      label: 'FATO',
      tone: 'info',
      text,
      evidence: { figures: bought !== null ? { purchased: bought, restocked, sold, lost } : { restocked, sold, lost } },
    })
  }

  const withRestock = i.stores.filter(s => s.restocked > 0)
  const selling = withRestock.filter(s => s.sold > 0)
  if (withRestock.length > 0) {
    out.push({
      kind: 'stores_selling',
      label: 'FATO',
      tone: selling.length === withRestock.length ? 'positive' : 'info',
      text: `Este produto vende em ${selling.length} das ${withRestock.length} lojas onde foi abastecido.`,
      evidence: { figures: { storesSelling: selling.length, storesRestocked: withRestock.length }, formula: 'lojas com venda ÷ lojas com abastecimento' },
    })
  }

  const totalRestocked = withRestock.reduce((s, r) => s + r.restocked, 0)
  const totalSold = withRestock.reduce((s, r) => s + r.sold, 0)
  const networkSellThrough = totalRestocked > 0 ? totalSold / totalRestocked : null
  if (networkSellThrough !== null) {
    const weak = i.stores.filter(s => s.situation === 'critical' || (s.sellThrough !== null && s.sellThrough < networkSellThrough * 0.5 && s.situation !== null)).slice(0, 2)
    for (const store of weak) {
      out.push({
        kind: 'store_below_network',
        label: 'MÉTRICA DERIVADA',
        tone: store.situation === 'critical' ? 'critical' : 'attention',
        text: `${store.storeName ?? `Loja ${store.storeId}`} recebeu ${units(store.restocked)}, mas vendeu ${units(store.sold)} e perdeu ${units(store.lost)}; o desempenho está abaixo da rede (${pct(store.sellThrough ?? 0)} contra ${pct(networkSellThrough)}).`,
        evidence: {
          figures: { restocked: store.restocked, sold: store.sold, lost: store.lost, sellThrough: store.sellThrough ?? 0, networkSellThrough },
          formula: 'vendido ÷ abastecido da loja, contra o mesmo índice da rede para este produto',
        },
      })
    }

    const strong = i.stores.filter(s => s.situation === 'good')
    const poor = i.stores.filter(s => s.situation === 'critical' || s.situation === 'attention')
    if (strong.length > 0 && strong.length <= 2 && poor.length >= 2) {
      out.push({
        kind: 'concentrated_demand',
        label: 'ESTIMATIVA',
        tone: 'info',
        text: `O produto vende bem em ${strong.map(s => s.storeName ?? `Loja ${s.storeId}`).join(' e ')}, mas apresenta baixa saída nas demais lojas. Considerar redistribuir o abastecimento (estimativa, não decisão).`,
        evidence: { figures: { storesGood: strong.length, storesBelow: poor.length }, formula: 'situação por loja a partir de vendido ÷ abastecido' },
      })
    }
  }

  if (i.networkLossShare !== null && restocked !== null && lost !== null && restocked >= i.p.minRestockedForSituation) {
    const own = lost / restocked
    if (own > i.networkLossShare * i.p.lossAboveNetworkFactor) {
      out.push({
        kind: 'loss_above_network',
        label: 'MÉTRICA DERIVADA',
        tone: 'attention',
        text: `A perda deste produto (${pct(own)} do abastecido) está acima da média da operação (${pct(i.networkLossShare)}).`,
        evidence: { figures: { productLossShare: own, networkLossShare: i.networkLossShare, factor: i.p.lossAboveNetworkFactor }, formula: 'perdido ÷ abastecido, contra a rede × fator' },
      })
    }
  }

  return out
}
