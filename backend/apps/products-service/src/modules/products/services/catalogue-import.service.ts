import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { classifyImport, summarise, type EanOwners, type ExistingProduct, type ImportOptions, type ImportRow, type ImportRowResult } from '../utils/catalogue-import'
import { EanService } from './ean.service'
import { ProductsService } from './products.service'

const MAX_ROWS = 5000

export interface ImportPreview {
  summary: Record<'create' | 'update' | 'unchanged' | 'conflict', number>
  rows: ImportRowResult[]
}

export interface ImportApplied extends ImportPreview {
  /** One entry per row that was attempted; a row that failed in the middle says why and the rest still ran. */
  results: { row: number; sku: string | null; action: string; ok: boolean; error?: string }[]
}

/**
 * Excel import of the catalogue. The preview writes nothing; the apply recomputes the preview on the CURRENT registry (never trusts a stale one) and
 * runs each row through the same services the manual form uses. Idempotent: a second run finds the rows unchanged. It creates and updates; it never
 * deletes a product, an EAN, a cost or a price.
 */
@Injectable()
export class CatalogueImportService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly products: ProductsService,
    private readonly eans: EanService,
  ) {}

  async preview(rows: ImportRow[], options: ImportOptions = {}): Promise<ImportPreview> {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('A planilha não tem linhas para importar')
    if (rows.length > MAX_ROWS) throw new BadRequestException(`A planilha tem mais de ${MAX_ROWS} linhas: divida em partes`)

    const skus = [...new Set(rows.map(row => String(row.sku ?? '').trim()).filter(Boolean))]
    const eans = [...new Set(rows.map(row => String(row.ean ?? '').trim()).filter(Boolean))]
    const [found, links] = await Promise.all([
      this.prisma.product.findMany({ where: { sku: { in: skus } }, include: { eans: true } }),
      this.prisma.productEan.findMany({ where: { ean: { in: eans } }, include: { product: { select: { sku: true } } } }),
    ])

    const existing: ExistingProduct[] = found.map(product => ({
      id: product.id, sku: product.sku, name: product.name, category: product.category, subcategory: product.subcategory, brand: product.brand, sale_unit: product.sale_unit,
      purchase_unit: product.purchase_unit, package_type: product.package_type, units_per_package: product.units_per_package,
      eans: product.eans.map(link => ({ ean: link.ean, status: link.status, is_primary: link.is_primary })),
    }))
    const owners: EanOwners = new Map()
    for (const link of links) owners.set(link.ean, [...(owners.get(link.ean) ?? []), { sku: link.product.sku, status: link.status }])

    const results = classifyImport(rows, existing, owners, options)

    return { summary: summarise(results), rows: results }
  }

  async apply(rows: ImportRow[], options: ImportOptions, actor: string): Promise<ImportApplied> {
    if (!actor.trim()) throw new BadRequestException('O usuário que importa é obrigatório')
    const preview = await this.preview(rows, options)
    const idBySku = new Map((await this.prisma.product.findMany({ where: { sku: { in: preview.rows.map(r => r.sku).filter((s): s is string => s !== null) } }, select: { id: true, sku: true } })).map(p => [p.sku, p.id]))
    const results: ImportApplied['results'] = []

    for (const item of preview.rows) {
      if (item.action === 'unchanged' || item.action === 'conflict' || !item.values) {
        results.push({ row: item.row, sku: item.sku, action: item.action, ok: item.action !== 'conflict', ...(item.action === 'conflict' ? { error: item.problems.join('; ') } : {}) })
        continue
      }
      try {
        const v = item.values
        if (item.action === 'create') {
          await this.products.create({ sku: v.sku, name: v.name as string, category: v.category as never, subcategory: v.subcategory ?? undefined, brand: v.brand ?? undefined, saleUnit: v.saleUnit, purchaseUnit: v.purchaseUnit ?? undefined, packageType: v.packageType ?? undefined, unitsPerPackage: v.unitsPerPackage ?? undefined, ean: v.ean, origin: 'excel', actor })
        } else {
          const id = idBySku.get(v.sku) as number
          const clear = (field: string) => (item.clears.includes(field) ? null : undefined)
          await this.products.update(id, {
            ...(v.name !== undefined ? { name: v.name } : {}),
            ...(v.category !== undefined ? { category: v.category } : {}),
            subcategory: v.subcategory ?? clear('subcategory'),
            brand: v.brand ?? clear('brand'),
            saleUnit: v.saleUnit,
            purchaseUnit: v.purchaseUnit ?? clear('purchaseUnit'),
            packageType: v.packageType ?? clear('packageType'),
            unitsPerPackage: v.unitsPerPackage ?? clear('unitsPerPackage'),
          })
          if (item.addEan) await this.eans.add(id, { ean: item.addEan, source: 'other', actor, note: 'Importação de planilha' })
        }
        results.push({ row: item.row, sku: item.sku, action: item.action, ok: true })
      } catch (error) {
        results.push({ row: item.row, sku: item.sku, action: item.action, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }

    return { ...preview, results }
  }
}
