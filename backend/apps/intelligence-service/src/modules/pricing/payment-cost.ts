import type { PaymentCost, PaymentCostComponent, PaymentMethod, VoucherBasis } from './pricing.types'

export interface FeeRate {
  acquirer: string
  method: PaymentMethod
  rateBps: number
  /** Fixed fee per sale, in centavos. */
  fixedCents?: number
}

/** One group of the sales payment mix, as the sales service returns it. */
export interface MixRow {
  method: string | null
  acquirer: string | null
  cardBrand: string | null
  receiptLines: number
  amountCents: number
}

const fold = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Maps the free text a sales report carries to a payment method; `null` when it does not say. */
export function methodOf(raw: string | null): PaymentMethod | null {
  const text = fold(raw)
  if (!text) return null
  if (text.includes('pix')) return 'pix'
  if (/(voucher|vale|refeic|aliment|beneficio|multibeneficio)/.test(text) || /^(vr|va)$/.test(text)) return 'voucher'
  if (text.includes('deb')) return 'debit'
  if (text.includes('cred')) return 'credit'
  return null
}

export interface VoucherFee {
  /** Basis points, fractional because it is an average. `null` when no voucher brand has a rate. */
  rateBps: number | null
  /** The same average over the brands' fixed fee per sale, in centavos. */
  fixedCents: number
  basis: VoucherBasis
  brands: { brand: string; rateBps: number; fixedCents: number; share: number }[]
  /** Brands with voucher sales and no registered rate. Never priced as 0%. */
  missingRateBrands: string[]
}

/**
 * The effective voucher fee: the average over the registered voucher brands,
 * weighted by each brand's share of the voucher sales when there is enough
 * volume, a simple average otherwise.
 */
export function effectiveVoucherFee(rates: FeeRate[], mix: MixRow[], minReceiptLines: number, aliases: Record<string, string> = {}): VoucherFee {
  const voucherRates = rates.filter(rate => rate.method === 'voucher')
  if (voucherRates.length === 0) return { rateBps: null, fixedCents: 0, basis: 'none', brands: [], missingRateBrands: [] }

  const voucherRows = mix.filter(row => methodOf(row.method) === 'voucher')
  const registered = voucherRates.map(rate => ({ ...rate, key: fold(rate.acquirer), fixedCents: rate.fixedCents ?? 0 }))
  // Sodexo is Pluxee: a sale reported under an alias is priced with the rate registered under the real name.
  const aliasOf = new Map(Object.entries(aliases).map(([from, to]) => [fold(from), fold(to)]))
  const canonical = (name: string | null) => {
    const key = fold(name)
    return aliasOf.get(key) ?? key
  }

  const amountByBrand = new Map<string, number>()
  const missing = new Set<string>()
  let lines = 0
  for (const row of voucherRows) {
    lines += row.receiptLines
    const candidates = [canonical(row.cardBrand), canonical(row.acquirer)].filter(Boolean)
    const hit = registered.find(rate => candidates.includes(rate.key))
    if (hit) amountByBrand.set(hit.key, (amountByBrand.get(hit.key) ?? 0) + row.amountCents)
    else if (row.amountCents > 0) missing.add(row.cardBrand ?? row.acquirer ?? 'sem bandeira')
  }

  const matched = [...amountByBrand.values()].reduce((sum, amount) => sum + amount, 0)
  const weighted = lines >= minReceiptLines && matched > 0

  if (weighted) {
    const brands = registered
      .filter(rate => amountByBrand.has(rate.key))
      .map(rate => ({ brand: rate.acquirer, rateBps: rate.rateBps, fixedCents: rate.fixedCents, share: (amountByBrand.get(rate.key) ?? 0) / matched }))

    return {
      rateBps: brands.reduce((sum, brand) => sum + brand.rateBps * brand.share, 0),
      fixedCents: brands.reduce((sum, brand) => sum + brand.fixedCents * brand.share, 0),
      basis: 'sales_weighted',
      brands,
      missingRateBrands: [...missing],
    }
  }

  const share = 1 / registered.length
  return {
    rateBps: registered.reduce((sum, rate) => sum + rate.rateBps * share, 0),
    fixedCents: registered.reduce((sum, rate) => sum + rate.fixedCents * share, 0),
    basis: 'simple_average',
    brands: registered.map(rate => ({ brand: rate.acquirer, rateBps: rate.rateBps, fixedCents: rate.fixedCents, share })),
    missingRateBrands: [...missing],
  }
}

/**
 * The payment cost of a price: each method's fee weighted by its real share of
 * the sales — never one fee over all of them. Sales whose method or rate cannot
 * be resolved are reported, and priced at the average of the resolved ones so
 * the result stays usable, but `complete` is false and confidence drops.
 */
export function paymentCost(rates: FeeRate[], mix: MixRow[], minVoucherReceiptLines: number, aliases: Record<string, string> = {}): PaymentCost | null {
  const total = mix.reduce((sum, row) => sum + row.amountCents, 0)
  if (total <= 0) return null

  const notes: string[] = []
  const voucher = effectiveVoucherFee(rates, mix, minVoucherReceiptLines, aliases)
  const totalLines = mix.reduce((sum, row) => sum + row.receiptLines, 0)
  const fixedOf = new Map(rates.map(rate => [`${fold(rate.acquirer)}|${rate.method}`, rate.fixedCents ?? 0]))
  // fixedOf is keyed by the registered name; row lookups go through the same alias map as the rates.
  let fixedCentsTotal = 0
  const amount: Record<PaymentMethod, number> = { pix: 0, debit: 0, credit: 0, voucher: 0 }
  const rateOf: Partial<Record<PaymentMethod, number>> = {}
  let unresolved = 0

  const aliasOf = new Map(Object.entries(aliases).map(([from, to]) => [fold(from), fold(to)]))
  const canonical = (name: string | null) => {
    const key = fold(name)
    return aliasOf.get(key) ?? key
  }
  const byKey = new Map(rates.map(rate => [`${canonical(rate.acquirer)}|${rate.method}`, rate.rateBps]))
  // Acquirers the sales actually tell apart, per method. When there is only one (today: PagSeguro), the registered
  // plans of that method cannot be told apart by the sale, so they are averaged (owner decision 2026-10-06).
  const acquirersInSales = new Map<PaymentMethod, Set<string>>()
  for (const row of mix) {
    const method = methodOf(row.method)
    if (!method) continue
    acquirersInSales.set(method, (acquirersInSales.get(method) ?? new Set()).add(canonical(row.acquirer)))
  }

  const resolvedRate = (method: PaymentMethod, acquirer: string | null): number | null => {
    if (method === 'voucher') return voucher.rateBps
    const ofMethod = rates.filter(rate => rate.method === method)
    if (ofMethod.length === 0) return null
    if ((acquirersInSales.get(method)?.size ?? 0) > 1) {
      const exact = byKey.get(`${canonical(acquirer)}|${method}`)
      if (exact !== undefined) return exact
    }
    if (ofMethod.length > 1) {
      const note = `Taxa de ${method} pela média simples de ${ofMethod.length} planos (a venda não identifica o plano)`
      if (!notes.includes(note)) notes.push(note)
    }
    return ofMethod.reduce((sum, rate) => sum + rate.rateBps, 0) / ofMethod.length
  }

  // Cost accumulated per row so two acquirers of one method keep their own rates.
  let weightedBps = 0
  const methodRate = new Map<PaymentMethod, { weight: number; bps: number }>()

  for (const row of mix) {
    const method = methodOf(row.method)
    if (!method) {
      unresolved += row.amountCents
      continue
    }
    const rate = resolvedRate(method, row.acquirer)
    if (rate === null) {
      unresolved += row.amountCents
      if (!notes.some(note => note.includes(method))) notes.push(`Sem taxa cadastrada para ${method}`)
      continue
    }
    amount[method] += row.amountCents
    weightedBps += rate * row.amountCents
    // A fixed fee is charged per sale, so it follows the share of receipt lines, not of revenue.
    const fixed = method === 'voucher' ? voucher.fixedCents : (fixedOf.get(`${canonical(row.acquirer)}|${method}`) ?? 0)
    fixedCentsTotal += fixed * row.receiptLines
    const entry = methodRate.get(method) ?? { weight: 0, bps: 0 }
    methodRate.set(method, { weight: entry.weight + row.amountCents, bps: entry.bps + rate * row.amountCents })
  }

  const resolved = total - unresolved
  for (const [method, entry] of methodRate) rateOf[method] = entry.bps / entry.weight
  if (voucher.missingRateBrands.length > 0) notes.push(`Bandeira sem taxa: ${voucher.missingRateBrands.join(', ')}`)
  if (voucher.basis === 'simple_average') notes.push('VR/VA pela média simples das bandeiras (volume insuficiente para ponderar)')

  const components: PaymentCostComponent[] = (Object.keys(amount) as PaymentMethod[])
    .filter(method => amount[method] > 0)
    .map(method => ({ method, share: amount[method] / total, rateBps: rateOf[method] ?? 0 }))

  return {
    rate: weightedBps / resolved / 10_000,
    fixedPerUnitCents: totalLines > 0 ? fixedCentsTotal / totalLines : 0,
    components,
    voucherShare: amount.voucher / total,
    voucherBasis: amount.voucher > 0 || voucher.basis !== 'none' ? voucher.basis : 'none',
    unresolvedShare: unresolved / total,
    complete: unresolved === 0 && voucher.missingRateBrands.length === 0,
    notes,
  }
}
