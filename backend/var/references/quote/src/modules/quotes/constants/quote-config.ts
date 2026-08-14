import { PRODUCT_EXPORT_FIELDS } from '@app/quote-search-match'

/**
 * Backend-owned source of truth for the column-mapping and export-builder
 * option catalogs. Hand-ported once from frontend/src/domain/fixtures.ts's
 * CATALOG_FIELDS/NORMALIZATION_RULES/EXPORT_FIELDS at migration time — the
 * frontend no longer hardcodes these; it fetches GET /quotes/config
 * (brief: "campos devem ser carregados dinamicamente conforme o schema
 * disponibilizado pelo backend").
 */
export const CATALOG_FIELDS = [
  { value: 'sku', label: 'SKU' },
  { value: 'name', label: 'Nome do produto' },
  { value: 'main_code', label: 'Código principal' },
  { value: 'ean', label: 'EAN' },
  { value: 'oem', label: 'OEM' },
  { value: 'trade_number', label: 'Trade Number' },
  { value: 'internal_code', label: 'Internal Code' },
  { value: 'old_code', label: 'Old Code' },
  { value: 'brand', label: 'Marca' },
  { value: 'category', label: 'Categoria' },
  { value: 'manufacturer', label: 'Fabricante' },
  { value: 'supplier_ref', label: 'Referência do fornecedor' },
  { value: 'description', label: 'Descrição' },
  { value: 'application', label: 'Aplicação' },
  { value: 'vehicle', label: 'Veículo' },
  { value: 'model', label: 'Modelo' },
  { value: 'engine', label: 'Motorização' },
  { value: 'custom', label: 'Campo personalizado' },
  { value: 'ignore', label: 'Ignorar coluna' },
]

export const NORMALIZATION_RULES = [
  { id: 'trim', label: 'Remover espaços extras' },
  { id: 'case', label: 'Ignorar maiúsculas/minúsculas' },
  { id: 'punct', label: 'Remover pontuação' },
  { id: 'special', label: 'Remover caracteres especiais' },
  { id: 'leading_zeros', label: 'Remover zeros à esquerda' },
  { id: 'hyphens', label: 'Normalizar hífens' },
  { id: 'slashes', label: 'Normalizar barras' },
  { id: 'split', label: 'Separar múltiplos códigos' },
  { id: 'accents', label: 'Ignorar acentos' },
  { id: 'terms', label: 'Comparar termos individualmente' },
]

/**
 * Export field catalog — composed from two sources, never hand-typed as
 * one flat fictional list (the previous version of this constant had six
 * fields, e.g. `old_codes`/`stock_reserved`/`not_found_reason`, that were
 * never backed by real data anywhere in this app):
 *
 * 1. Real catalog fields: `PRODUCT_EXPORT_FIELDS`, shared with
 *    `apps/search` via `@app/quote-search-match` — every entry already
 *    security-reviewed against `PRODUCT_BUNDLE_SOURCE_ALLOWLIST` (see
 *    that package's CLAUDE.md). Populated at export time by fetching each
 *    item's matched product fresh (`GenerateExportWorker`), not from the
 *    match-time snapshot alone.
 * 2. Quote-local review fields below — not Elasticsearch data at all,
 *    always available directly from the `QuoteItem` row.
 */
const REVIEW_RESULT_EXPORT_FIELDS = [
  { id: 'match_score', label: 'Score do match' },
  { id: 'review_status', label: 'Status da revisão' },
  { id: 'review_decision', label: 'Decisão do usuário' },
  { id: 'reviewed_by', label: 'Usuário revisor' },
  { id: 'reviewed_at', label: 'Data da revisão' },
]

export const EXPORT_FIELDS = [
  ...Object.values(
    PRODUCT_EXPORT_FIELDS.reduce<Record<string, { group: string; fields: { id: string; label: string }[] }>>(
      (groups, field) => {
        groups[field.group] ??= { group: field.group, fields: [] }
        groups[field.group].fields.push({ id: field.id, label: field.label })
        return groups
      },
      {},
    ),
  ),
  { group: 'Resultado do matching', fields: REVIEW_RESULT_EXPORT_FIELDS },
]
