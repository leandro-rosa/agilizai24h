/**
 * Plano de sincronização do catálogo a partir da planilha de precificação.
 * Função pura: recebe as linhas da planilha e o estado atual do catálogo e
 * devolve o que seria criado/alterado, mais os avisos. Nada é gravado aqui.
 *
 * Só CRIA produtos novos e registra versões de custo/preço. Nunca altera nome,
 * categoria nem EAN de um produto que já existe (decisão deliberada: a planilha
 * não é revisada linha a linha e isso reescreveria cadastro em silêncio).
 */
import type { ProductCategory } from '../constants/product-vocabulary'

export interface SheetRow {
  /** Linha na planilha (1 = cabeçalho), para o operador achar o problema. */
  row: number
  sku: string
  name: string
  category: string | null
  subcategory: string | null
  ean: string | null
  supplier: string | null
  cost_cents: number | null
  /** A célula de custo continha um erro de fórmula (#ERROR!, #REF!…). */
  cost_error: boolean
  price_cents: number | null
  /** Coluna "Medida": unidade, fardo, caixa. */
  package_type: string | null
}

export interface CatalogueEntry {
  sku: string
  name: string
  ean: string | null
  cost_cents: number | null
  price_cents: number | null
}

export type IssueCode =
  | 'missing_name'
  | 'duplicate_sku'
  | 'conflicting_duplicate'
  | 'cost_error'
  | 'cost_missing'
  | 'zero_cost'
  | 'price_missing'
  | 'ean_conflict'
  | 'ean_invalid'
  | 'category_blank'

export interface Issue {
  /** `blocked` = a linha não pode ser aplicada; `warning` = aplica, mas merece olhar. */
  severity: 'blocked' | 'warning'
  code: IssueCode
  sku: string | null
  row: number
  message: string
}

export interface CreateItem {
  sku: string
  name: string
  category: ProductCategory
  subcategory: string | null
  ean: string | null
  supplier: string | null
  package_type: string | null
  cost_cents: number | null
  price_cents: number | null
  row: number
}

export interface ChangeItem {
  sku: string
  name: string
  current_cents: number | null
  new_cents: number
  row: number
}

export interface SyncPlan {
  create: CreateItem[]
  costs: ChangeItem[]
  prices: ChangeItem[]
  issues: Issue[]
  /** Linhas de produtos já cadastrados cujo custo e preço já batem. */
  unchanged: number
}

/**
 * Mesma convenção do catálogo atual (verificada nos 233 produtos): Bebidas e
 * Cafés → beverage, Mercearia → essential, todo o resto → snack (inclusive
 * congelados e marmitas). O vocabulário tem só 4 categorias; o detalhe fica na
 * subcategoria.
 */
export function mapCategory(sheetCategory: string | null): ProductCategory {
  const c = (sheetCategory ?? '').trim().toLowerCase()
  if (c === 'bebidas' || c === 'cafés' || c === 'cafes') return 'beverage'
  if (c === 'mercearia') return 'essential'
  return 'snack'
}

/** EAN válido = só dígitos, 8 a 14. "7.89856E+12" (precisão perdida pelo Excel) não vale. */
export function cleanEan(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.trim()
  return /^\d{8,14}$/.test(digits) ? digits : null
}

export function planSync(rows: SheetRow[], catalogue: CatalogueEntry[]): SyncPlan {
  const bySku = new Map(catalogue.map(c => [c.sku, c]))
  const eanOwner = new Map<string, string>()
  for (const c of catalogue) if (c.ean) eanOwner.set(c.ean, c.sku)

  const plan: SyncPlan = { create: [], costs: [], prices: [], issues: [], unchanged: 0 }
  const seen = new Map<string, SheetRow>()
  const issue = (severity: Issue['severity'], code: IssueCode, r: SheetRow, message: string) =>
    plan.issues.push({ severity, code, sku: r.sku || null, row: r.row, message })

  for (const r of rows) {
    const sku = r.sku.trim()
    // Linha vazia (a planilha traz centenas de linhas só com fórmula de custo): ignorada sem ruído.
    if (!sku && !r.name.trim()) continue
    if (!sku) continue

    const first = seen.get(sku)
    if (first) {
      const same = first.cost_cents === r.cost_cents && first.price_cents === r.price_cents && first.name.trim() === r.name.trim()
      issue(
        'warning',
        same ? 'duplicate_sku' : 'conflicting_duplicate',
        r,
        same
          ? `SKU ${sku} repetido (linha ${first.row}); a repetição foi ignorada.`
          : `SKU ${sku} repetido com valores diferentes (linha ${first.row} vs. ${r.row}); vale a primeira.`,
      )
      continue
    }
    seen.set(sku, r)

    const existing = bySku.get(sku)

    if (r.cost_error) issue('warning', 'cost_error', r, `Custo com erro de fórmula na planilha (SKU ${sku}); custo não aplicado.`)
    else if (r.cost_cents === 0) issue('warning', 'zero_cost', r, `Custo R$ 0,00 (SKU ${sku}): a margem aparecerá como 100%. Se foi brinde, ok; se for comprar, informe o custo.`)

    if (!existing) {
      if (!r.name.trim()) {
        issue('blocked', 'missing_name', r, `SKU ${sku} sem nome na planilha; não dá para cadastrar.`)
        continue
      }
      if (!r.category?.trim()) issue('warning', 'category_blank', r, `SKU ${sku} sem categoria; cadastrado como "snack".`)
      if (!r.cost_error && r.cost_cents === null) issue('warning', 'cost_missing', r, `SKU ${sku} sem custo na planilha; margem indisponível até informar.`)
      if (r.price_cents === null) issue('warning', 'price_missing', r, `SKU ${sku} sem preço na planilha.`)

      let ean = cleanEan(r.ean)
      if (r.ean && !ean) issue('warning', 'ean_invalid', r, `EAN "${r.ean}" inválido (SKU ${sku}); cadastrado sem EAN. Formate a coluna como texto/número inteiro.`)
      if (ean && eanOwner.has(ean)) {
        issue('warning', 'ean_conflict', r, `EAN ${ean} já pertence ao SKU ${eanOwner.get(ean)}; SKU ${sku} cadastrado sem EAN.`)
        ean = null
      }
      if (ean) eanOwner.set(ean, sku)

      plan.create.push({
        sku,
        name: r.name.trim(),
        category: mapCategory(r.category),
        subcategory: r.subcategory?.trim() || null,
        ean,
        supplier: r.supplier?.trim() || null,
        package_type: r.package_type?.trim().toLowerCase() || null,
        cost_cents: r.cost_error ? null : r.cost_cents,
        price_cents: r.price_cents,
        row: r.row,
      })
      continue
    }

    let touched = false
    if (!r.cost_error && r.cost_cents !== null && r.cost_cents !== existing.cost_cents) {
      plan.costs.push({ sku, name: existing.name, current_cents: existing.cost_cents, new_cents: r.cost_cents, row: r.row })
      touched = true
    }
    if (r.price_cents !== null && r.price_cents !== existing.price_cents) {
      plan.prices.push({ sku, name: existing.name, current_cents: existing.price_cents, new_cents: r.price_cents, row: r.row })
      touched = true
    }
    if (!touched) plan.unchanged += 1
  }

  return plan
}
