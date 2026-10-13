export interface SupplierBalance {
  supplierId: number
  balance: number
}

export type AttributionBasis = 'single' | 'manual' | 'none' | 'ambiguous'

export interface Attribution {
  supplierId: number | null
  basis: AttributionBasis
  /** True when the sale cannot be assigned without the operator: it blocks a closing that depends on it. */
  pending: boolean
  /** An ESTIMATE only (largest sellable balance); never applied by itself. */
  suggestion: number | null
}

/** A sale carries no lot, so the ledger proves a supplier only when exactly one holds the SKU in that store. */
export function attributeSale(holders: SupplierBalance[], manualSupplierId?: number | null): Attribution {
  const sellable = holders.filter(h => h.balance > 0)

  if (sellable.length === 0) return { supplierId: null, basis: 'none', pending: false, suggestion: null }
  if (sellable.length === 1) return { supplierId: sellable[0].supplierId, basis: 'single', pending: false, suggestion: null }
  if (manualSupplierId != null && sellable.some(h => h.supplierId === manualSupplierId)) return { supplierId: manualSupplierId, basis: 'manual', pending: false, suggestion: null }

  const largest = [...sellable].sort((a, b) => b.balance - a.balance || a.supplierId - b.supplierId)[0]

  return { supplierId: null, basis: 'ambiguous', pending: true, suggestion: largest.supplierId }
}
