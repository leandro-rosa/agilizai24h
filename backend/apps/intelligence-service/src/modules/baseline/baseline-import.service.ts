import { Injectable, Logger } from '@nestjs/common'
import { ProductsClient } from '../sources/products.client'
import { BaselineRepository } from './baseline.repository'
import { parsePricingSheet, type Conflict, type RejectedRow, type Resolution, type SheetRow } from './pricing-sheet.parser'
import { ProductPackagingWriter } from './product-packaging.writer'

export interface BaselineImportInput {
  /** Where the rows came from, e.g. the sheet's file name; stored with every baseline. */
  source: string
  rows: SheetRow[]
  /** The owner's explicit choice for SKUs whose rows disagree. */
  resolutions?: Record<string, Resolution>
  /** ISO date the baselines take effect; defaults to now. */
  effectiveFrom?: string
  /** Nothing is written unless this is true. The default is a dry run that only reports. */
  apply?: boolean
  correlationId?: string
}

export interface BaselineImportReport {
  apply: boolean
  source: string
  totals: {
    rows: number
    ignoredBlank: number
    accepted: number
    rejected: number
    conflicts: number
    resolved: number
    collapsedDuplicates: number
    baselinesToAdd: number
    baselinesUnchanged: number
    packagingToUpdate: number
    packagingUnchanged: number
    notInCatalogue: number
    packagingFailed: number
  }
  rejected: RejectedRow[]
  conflicts: Conflict[]
  resolved: { sku: string; chosen: { quantity: number; measure: string } }[]
  /** SKUs in the sheet that the product catalogue does not know: their baseline is kept, their packaging is not written. */
  notInCatalogue: string[]
  packagingFailed: { sku: string; detail: string }[]
}

/**
 * Imports baselines and packaging from the pricing sheet.
 *
 * A dry run (the default) classifies everything and writes nothing, so the
 * owner reviews the rejections and conflicts first. Applying appends a
 * baseline only when the value differs from the one in force (history is
 * append-only and an identical re-import adds nothing), and writes the
 * packaging only where it differs.
 */
@Injectable()
export class BaselineImportService {
  private readonly logger = new Logger(BaselineImportService.name)

  constructor(
    private readonly baselines: BaselineRepository,
    private readonly products: ProductsClient,
    private readonly packaging: ProductPackagingWriter,
  ) {}

  async run(input: BaselineImportInput): Promise<BaselineImportReport> {
    const apply = input.apply === true
    const parsed = parsePricingSheet(input.rows, input.resolutions)
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date()

    const catalogue = new Map((await this.products.products(input.correlationId)).map(product => [product.sku, product]))

    let baselinesToAdd = 0
    let baselinesUnchanged = 0
    let packagingToUpdate = 0
    let packagingUnchanged = 0
    const notInCatalogue: string[] = []
    const packagingFailed: { sku: string; detail: string }[] = []

    for (const item of parsed.accepted) {
      const current = await this.baselines.current(item.sku, new Date())

      if (current?.quantity === item.quantity) {
        baselinesUnchanged++
      } else {
        baselinesToAdd++
        if (apply) await this.baselines.add(item.sku, item.quantity, input.source, effectiveFrom)
      }

      const product = catalogue.get(item.sku)
      if (!product) {
        notInCatalogue.push(item.sku)
        continue
      }

      if (product.package_type === item.measure) {
        packagingUnchanged++
        continue
      }

      packagingToUpdate++
      if (!apply) continue

      try {
        await this.packaging.setPackageType(product.id, item.measure, input.correlationId)
      } catch (error) {
        // One product failing must not stop the others, and must not be reported as done.
        packagingFailed.push({ sku: item.sku, detail: error instanceof Error ? error.message : String(error) })
      }
    }

    if (apply) {
      this.logger.log(
        `Baseline import "${input.source}": ${baselinesToAdd} added, ${baselinesUnchanged} unchanged, ` +
          `${packagingToUpdate - packagingFailed.length} packaging updated, ${parsed.rejected.length} rejected, ${parsed.conflicts.length} conflicts`,
      )
    }

    return {
      apply,
      source: input.source,
      totals: {
        rows: input.rows.length,
        ignoredBlank: parsed.ignoredBlank,
        accepted: parsed.accepted.length,
        rejected: parsed.rejected.length,
        conflicts: parsed.conflicts.length,
        resolved: parsed.resolved.length,
        collapsedDuplicates: parsed.collapsedDuplicates.length,
        baselinesToAdd,
        baselinesUnchanged,
        packagingToUpdate,
        packagingUnchanged,
        notInCatalogue: notInCatalogue.length,
        packagingFailed: packagingFailed.length,
      },
      rejected: parsed.rejected,
      conflicts: parsed.conflicts,
      resolved: parsed.resolved.map(entry => ({ sku: entry.sku, chosen: entry.chosen })),
      notInCatalogue,
      packagingFailed,
    }
  }
}
