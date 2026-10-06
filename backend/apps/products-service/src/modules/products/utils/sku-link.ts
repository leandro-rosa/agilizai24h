/**
 * Regras puras dos vínculos de SKU (troca de código de barras). Só decisões
 * "same" formam vínculo; "different" apenas silencia a sugestão.
 */
export interface LinkRow {
  old_sku: string
  new_sku: string
  decision: string
}

/** Seguindo os vínculos "same" a partir de `from`, chega em `target`? (old → new → new...) */
export function reaches(links: LinkRow[], from: string, target: string): boolean {
  const next = new Map<string, string[]>()
  for (const l of links) {
    if (l.decision !== 'same') continue
    next.set(l.old_sku, [...(next.get(l.old_sku) ?? []), l.new_sku])
  }
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const cur = stack.pop() as string
    if (cur === target) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    stack.push(...(next.get(cur) ?? []))
  }
  return false
}

/**
 * Um novo vínculo "same" old → new é inválido se: (a) old == new; (b) fecharia
 * um ciclo (new já leva até old); (c) o `old_sku` já foi declarado como o mesmo
 * produto de OUTRO novo SKU (um código antigo não vira dois produtos).
 */
export function validateSameLink(existing: LinkRow[], oldSku: string, newSku: string): string | null {
  if (oldSku === newSku) return 'Um SKU não pode ser o sucessor dele mesmo'
  if (reaches(existing, newSku, oldSku)) return 'Este vínculo fecharia um ciclo entre SKUs'
  const other = existing.find((l) => l.decision === 'same' && l.old_sku === oldSku && l.new_sku !== newSku)
  if (other) return `O SKU ${oldSku} já foi vinculado a ${other.new_sku}`
  return null
}
