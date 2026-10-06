/**
 * Decide se gerar o resumo de um mês cria uma versão nova. Mesma base do DRE
 * e mesmo conteúdo = a mesma versão (reabrir/reexportar não infla versões);
 * qualquer um dos dois mudou = versão seguinte. Pura para ser testável sem banco.
 */
export interface VersionRow {
  version: number
  base_at: Date
  content_hash: string
}

export function decideVersion(
  latest: VersionRow | null,
  baseAt: Date,
  contentHash: string,
): { action: 'reuse'; version: number } | { action: 'create'; version: number } {
  if (!latest) return { action: 'create', version: 1 }
  const sameBase = latest.base_at.getTime() === baseAt.getTime()
  if (sameBase && latest.content_hash === contentHash) return { action: 'reuse', version: latest.version }
  return { action: 'create', version: latest.version + 1 }
}
