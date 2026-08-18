/**
 * The six removal reasons and their loss classification.
 *
 * Validated against several months of production data from the source system:
 * three of these are real loss and three are not, and getting the split wrong
 * misstates the one number the operators are trying to control.
 *
 * This constant seeds the database and is the source the seed migration is
 * generated from. At runtime the TABLE is authoritative — code must read the
 * flag from the row, never re-derive it from this list, or the two can diverge
 * and the copy in the reporting path is the one people would trust.
 */
export interface RemovalReasonDefinition {
  key: string
  /** What the operators see, in Portuguese — matches the glossary. */
  label: string
  countsAsLoss: boolean
}

export const REMOVAL_REASONS: RemovalReasonDefinition[] = [
  // Counts as real loss.
  { key: 'expired', label: 'Validade vencida', countsAsLoss: true },
  { key: 'damaged_product', label: 'Produto danificado', countsAsLoss: true },
  { key: 'other_reason', label: 'Outro motivo', countsAsLoss: true },
  // Does NOT count as loss — the units left the shelf, but nothing was lost.
  { key: 'return', label: 'Devolução', countsAsLoss: false },
  { key: 'transfer', label: 'Transferência', countsAsLoss: false },
  { key: 'internal_use', label: 'Uso e consumo', countsAsLoss: false },
]

export const LOSS_COUNTING_KEYS = REMOVAL_REASONS.filter(r => r.countsAsLoss).map(r => r.key)
export const NON_LOSS_KEYS = REMOVAL_REASONS.filter(r => !r.countsAsLoss).map(r => r.key)
