import { normalizeReasonText } from './parse-removal-reasons'

/**
 * The three operation kinds the restocking export produces.
 *
 * Recognised explicitly, same reasoning as the removal reasons: an
 * unrecognised kind must be rejected and named, never silently treated as
 * restocking — see design "report-layout" spec, "Operation kinds".
 */
export const OPERATION_KIND_LABEL_TO_KEY: Record<string, string> = {
  abastecimento: 'restocking',
  inventario: 'inventory',
  combinado: 'combined',
}

export type OperationKindKey = 'restocking' | 'inventory' | 'combined'

export function resolveOperationKind(label: string): OperationKindKey | null {
  const key = OPERATION_KIND_LABEL_TO_KEY[normalizeReasonText(label)]
  return (key as OperationKindKey) ?? null
}
