export interface SaleFact {
  storeId: number
  sku: string
  /** Null when the report carries no timestamp: the day of the sale is unknown, not zero. */
  occurredAt: Date | null
  quantity: number
  /** The report's `Resultado`, verbatim. Only `OK` is a confirmed sale. */
  result: string
  receiptId: string | null
}

export interface KeyedSale extends SaleFact {
  key: string
  occurredAt: Date
  receiptId: string
}

const present = (value?: string | null) => (value && value.trim() !== '' ? value.trim() : null)

/** Coupon, else internal code, else acquirer code. */
export function receiptIdOf(row: { coupon?: string | null; internalCode?: string | null; acquirerCode?: string | null }): string | null {
  return present(row.coupon) ?? present(row.internalCode) ?? present(row.acquirerCode)
}

/**
 * The key does NOT include the result: a sale that is later cancelled in a corrected report keeps its key, so the
 * change is detected as an adjustment of a confirmed line instead of looking like a new sale.
 */
export function keySales(facts: SaleFact[]): { keyed: KeyedSale[]; unidentified: SaleFact[] } {
  const unidentified: SaleFact[] = []
  const identified: Array<{ fact: SaleFact & { occurredAt: Date; receiptId: string }; base: string; index: number }> = []

  facts.forEach((fact, index) => {
    if (!fact.occurredAt || !fact.receiptId) {
      unidentified.push(fact)

      return
    }
    const base = `${fact.storeId}|${fact.sku}|${fact.occurredAt.toISOString()}|${fact.receiptId}`
    identified.push({ fact: { ...fact, occurredAt: fact.occurredAt, receiptId: fact.receiptId }, base, index })
  })

  identified.sort((a, b) => a.base.localeCompare(b.base) || a.fact.quantity - b.fact.quantity || a.fact.result.localeCompare(b.fact.result) || a.index - b.index)

  const seen = new Map<string, number>()
  const keyed = identified.map(({ fact, base }) => {
    const ordinal = seen.get(base) ?? 0
    seen.set(base, ordinal + 1)

    return { ...fact, key: `${base}|${ordinal}` }
  })

  return { keyed, unidentified }
}
