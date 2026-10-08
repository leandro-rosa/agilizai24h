/**
 * Travel cost (Deslocamento) per restocking, from what the system already has: the monthly spend on the account and the number of restocking visits of
 * the same month. It is an AVERAGE, never a cost of a route or of a visit: nobody recorded the real cost per route.
 *
 *   average per restocking = the month's travel spend ÷ the restocking visits of the SAME month
 *
 * Over a window it pools the months that have both figures (sum of spend ÷ sum of visits), never an average of monthly averages. A month with no spend
 * figure or with zero or unknown visits is excluded and listed with its reason: there is no division by zero and no cost of zero assumed. The unit of count
 * is one store served in one restocking operation, so a trip that serves several stores counts several. The travel account does not say which activity a
 * trip served, so the average is not exclusive to the minimarket, and that is stated with every figure.
 */
export interface TravelMonthInput {
  period: string
  /** The month's spend on the per-visit account(s); `null` when the DRE of that month was not computed. */
  costCents: number | null
  /** Restocking visits of the scope in that month; `null` when the supply service has no visit row for it (unknown, not zero). */
  visits: number | null
}

export type TravelMonthStatus = 'used' | 'no_cost' | 'no_visits' | 'zero_visits'

export interface TravelMonth extends TravelMonthInput {
  perVisitCents: number | null
  status: TravelMonthStatus
}

export interface StoreTravelShare {
  storeId: number
  visits: number
  /** The average per restocking times this store's restocking visits: an estimated apportionment, not the real cost of reaching this store. */
  estimatedCents: number
}

export interface TravelEstimate {
  scope: string
  unit: string
  /** The estimated average per restocking over the months used; `null` when no month has both figures. */
  perVisitCents: number | null
  /** What went into it: the pooled spend and visits of the used months. */
  usedCostCents: number
  usedVisits: number
  months: TravelMonth[]
  excludedMonths: { period: string; reason: string }[]
  /** Only for the network and only from real per-store visit counts; an estimated apportionment, never a store's real travel cost. */
  stores: StoreTravelShare[]
  /** Said with every figure, because the average is easy to read as more than it is. */
  limitations: string[]
}

export const TRAVEL_UNIT = 'um abastecimento = uma loja atendida em uma operação de reposição (uma viagem que atende várias lojas conta várias)'

const REASON: Record<Exclude<TravelMonthStatus, 'used'>, string> = {
  no_cost: 'sem DRE com o gasto de deslocamento',
  no_visits: 'sem registro de abastecimentos no mês (desconhecido, não zero)',
  zero_visits: 'zero abastecimentos no mês: não há divisão',
}

export function travelEstimate(input: { scope: string; months: TravelMonthInput[]; visitsByStore?: Map<number, number>; usedMonthsOnly?: boolean }): TravelEstimate {
  const months: TravelMonth[] = input.months.map(month => {
    if (month.costCents === null) return { ...month, perVisitCents: null, status: 'no_cost' }
    if (month.visits === null) return { ...month, perVisitCents: null, status: 'no_visits' }
    if (month.visits <= 0) return { ...month, perVisitCents: null, status: 'zero_visits' }

    return { ...month, perVisitCents: month.costCents / month.visits, status: 'used' }
  })

  const used = months.filter(month => month.status === 'used')
  const usedCost = used.reduce((sum, month) => sum + (month.costCents as number), 0)
  const usedVisits = used.reduce((sum, month) => sum + (month.visits as number), 0)
  const perVisit = usedVisits > 0 ? usedCost / usedVisits : null

  const stores: StoreTravelShare[] =
    perVisit === null || !input.visitsByStore
      ? []
      : [...input.visitsByStore.entries()].filter(([, visits]) => visits > 0).map(([storeId, visits]) => ({ storeId, visits, estimatedCents: perVisit * visits })).sort((a, b) => a.storeId - b.storeId)

  return {
    scope: input.scope,
    unit: TRAVEL_UNIT,
    perVisitCents: perVisit,
    usedCostCents: usedCost,
    usedVisits,
    months,
    excludedMonths: months.filter(month => month.status !== 'used').map(month => ({ period: month.period, reason: REASON[month.status as Exclude<TravelMonthStatus, 'used'>] })),
    stores,
    limitations: [
      'Custo médio estimado por abastecimento (gasto de deslocamento ÷ abastecimentos do mesmo mês), não o custo real de uma rota ou de uma visita.',
      'A conta de deslocamento não separa a atividade: pode incluir viagens de frutas, coffee break ou outras, enquanto os abastecimentos contados são só os de lojas. A média não é exclusiva do minimercado.',
      ...(stores.length > 0 ? ['O valor por loja é um rateio estimado (média × abastecimentos da loja), não o custo real de chegar a ela.'] : []),
    ],
  }
}
