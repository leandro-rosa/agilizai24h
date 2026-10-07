import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { EAN_STATUS, WRITABLE_EAN_SOURCES, type EanSource } from '../constants/product-vocabulary'
import { cleanEan, lookupEan } from '../utils/ean'
import { toEanView, toProductView, type ProductEanView, type ProductView } from '../utils/product-view'

export interface AddEanInput {
  ean: string
  /** `YYYY-MM-DD`: when this EAN starts to be the product's barcode. */
  validFrom?: string | null
  note?: string | null
  /** Make it the principal EAN. Does not touch the others. */
  makePrimary?: boolean
  /** Make it the principal AND retire the current principal (inactive, with an end date), keeping it in the history. */
  retireCurrent?: boolean
  source?: string
  /** The session user, set by the gateway. */
  actor?: string | null
}

export interface UpdateEanInput {
  status?: 'active' | 'inactive'
  /** `YYYY-MM-DD`: end of validity when inactivating (today when omitted). */
  validTo?: string | null
  primary?: boolean
  note?: string | null
}

export type EanResolution =
  | { ean: string; match: 'active' | 'historical'; product: ProductView }
  | { ean: string; unresolved: 'ean_not_identified' | 'ean_ambiguous' | 'ean_invalid'; candidates?: string[] }

const DAY = /^\d{4}-\d{2}-\d{2}$/

function parseDay(value: string | null | undefined, name: string): Date | null {
  if (value === undefined || value === null || value === '') return null
  if (!DAY.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${name} must be a real date, YYYY-MM-DD`)

  return new Date(`${value}T00:00:00Z`)
}

const today = (): Date => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
const dayBefore = (date: Date): Date => new Date(date.getTime() - 86_400_000)

const text = (value: string | null | undefined, name: string, max: number): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be text`)
  if (value.trim().length > max) throw new BadRequestException(`${name} is too long (max ${max})`)

  return value.trim() === '' ? null : value.trim()
}

/** A unique-index violation the pre-checks could not see (two requests racing): still a conflict, never a 500. */
function asConflict(error: unknown): never {
  if ((error as { code?: string })?.code === 'P2002') throw new ConflictException('This EAN was just linked by another request; reload and try again')
  throw error
}

/**
 * The EANs of a product. An EAN is the barcode of a package, the SKU is the product: a new barcode or packaging adds a
 * link, it never creates a product and never deletes the old link. The only way to stop using an EAN is to inactivate
 * it, which keeps it in the history and keeps it resolving to the same SKU.
 */
@Injectable()
export class EanService {
  constructor(private readonly prisma: PrismaClientService) {}

  async list(productId: number): Promise<ProductEanView[]> {
    await this.productOrThrow(productId)
    const links = await this.prisma.productEan.findMany({ where: { product_id: productId }, orderBy: [{ is_primary: 'desc' }, { status: 'asc' }, { id: 'asc' }] })

    return links.map(toEanView)
  }

  async add(productId: number, input: AddEanInput): Promise<ProductEanView[]> {
    const ean = cleanEan(input.ean)
    if (!ean) throw new BadRequestException('EAN inválido: use só dígitos, de 8 a 14')

    const source = (input.source ?? 'other') as EanSource
    if (!(WRITABLE_EAN_SOURCES as readonly string[]).includes(source)) throw new BadRequestException(`source must be one of: ${WRITABLE_EAN_SOURCES.join(', ')}`)
    const actor = text(input.actor, 'actor', 200)
    if (source === 'manual' && !actor) throw new BadRequestException('A manual EAN needs the user')
    const validFrom = parseDay(input.validFrom, 'validFrom')
    const note = text(input.note, 'note', 500)
    await this.productOrThrow(productId)

    try {
      await this.prisma.$transaction(async tx => {
        const sameProduct = await tx.productEan.findUnique({ where: { product_id_ean: { product_id: productId, ean } } })
        if (sameProduct) {
          throw new ConflictException(
            sameProduct.status === EAN_STATUS.ACTIVE ? `O EAN ${ean} já está ativo neste produto` : `O EAN ${ean} já foi vinculado a este produto e está inativo: reative-o em vez de cadastrar de novo`,
          )
        }

        const elsewhere = await tx.productEan.findFirst({ where: { ean, status: EAN_STATUS.ACTIVE }, include: { product: { select: { sku: true } } } })
        if (elsewhere) throw new ConflictException(`O EAN ${ean} está ativo no produto ${elsewhere.product.sku}; ele não pode ser de dois produtos ao mesmo tempo`)

        const current = await tx.productEan.findFirst({ where: { product_id: productId, is_primary: true } })
        const becomesPrimary = input.makePrimary === true || input.retireCurrent === true || current === null

        if (current && becomesPrimary) {
          // The old principal is never deleted: it either stays active as a secondary EAN or is retired with an end date.
          await tx.productEan.update({
            where: { id: current.id },
            data: input.retireCurrent ? { status: EAN_STATUS.INACTIVE, is_primary: false, valid_to: validFrom ? dayBefore(validFrom) : today() } : { is_primary: false },
          })
        }

        await tx.productEan.create({ data: { product_id: productId, ean, status: EAN_STATUS.ACTIVE, is_primary: becomesPrimary, valid_from: validFrom, source, actor, note } })
      })
    } catch (error) {
      asConflict(error)
    }

    return this.list(productId)
  }

  async update(productId: number, eanId: number, input: UpdateEanInput): Promise<ProductEanView[]> {
    const validTo = parseDay(input.validTo, 'validTo')
    const note = input.note === undefined ? undefined : text(input.note, 'note', 500)
    const link = await this.prisma.productEan.findFirst({ where: { id: eanId, product_id: productId } })
    if (!link) throw new NotFoundException(`EAN ${eanId} not found on product ${productId}`)
    if (input.status === EAN_STATUS.INACTIVE && input.primary === true) throw new BadRequestException('Um EAN inativo não pode ser o principal')

    try {
      await this.prisma.$transaction(async tx => {
        const data: Record<string, unknown> = {}
        if (note !== undefined) data.note = note

        if (input.status === EAN_STATUS.INACTIVE && link.status === EAN_STATUS.ACTIVE) {
          if (validTo && link.valid_from && validTo < link.valid_from) throw new BadRequestException('validTo cannot be before the start of validity')
          Object.assign(data, { status: EAN_STATUS.INACTIVE, is_primary: false, valid_to: validTo ?? today() })
        }

        if (input.status === EAN_STATUS.ACTIVE && link.status === EAN_STATUS.INACTIVE) {
          const elsewhere = await tx.productEan.findFirst({ where: { ean: link.ean, status: EAN_STATUS.ACTIVE }, include: { product: { select: { sku: true } } } })
          if (elsewhere) throw new ConflictException(`O EAN ${link.ean} está ativo no produto ${elsewhere.product.sku}; não dá para reativá-lo aqui`)
          Object.assign(data, { status: EAN_STATUS.ACTIVE, valid_to: null })
        }

        if (input.primary === true) {
          const willBeActive = (data.status ?? link.status) === EAN_STATUS.ACTIVE
          if (!willBeActive) throw new BadRequestException('Só um EAN ativo pode ser o principal')
          await tx.productEan.updateMany({ where: { product_id: productId, is_primary: true, NOT: { id: eanId } }, data: { is_primary: false } })
          data.is_primary = true
        } else if (input.primary === false) {
          data.is_primary = false
        }

        if (Object.keys(data).length > 0) await tx.productEan.update({ where: { id: eanId }, data })
      })
    } catch (error) {
      asConflict(error)
    }

    return this.list(productId)
  }

  /**
   * Finds the SKU of each EAN, active or historical. Partitioned like the other lookups: `unresolved` says why, and a
   * line with an unknown EAN is reported as "EAN não identificado" — it never becomes a product on its own.
   */
  async resolve(eans: string[]): Promise<{ resolved: Extract<EanResolution, { match: string }>[]; unresolved: Extract<EanResolution, { unresolved: string }>[] }> {
    const resolved: Extract<EanResolution, { match: string }>[] = []
    const unresolved: Extract<EanResolution, { unresolved: string }>[] = []
    const requested = [...new Set(eans.map(raw => String(raw).trim()))]
    const valid = requested.map(raw => ({ raw, clean: cleanEan(raw) }))

    const links = await this.prisma.productEan.findMany({
      where: { ean: { in: valid.flatMap(v => (v.clean ? [v.clean] : [])) } },
      include: { product: { include: { eans: true } } },
    })

    for (const { raw, clean } of valid) {
      if (!clean) {
        unresolved.push({ ean: raw, unresolved: 'ean_invalid' })
        continue
      }

      const found = lookupEan(links.filter(link => link.ean === clean).map(link => ({ ...link, sku: link.product.sku })))
      if (found.kind === 'unknown') unresolved.push({ ean: clean, unresolved: 'ean_not_identified' })
      else if (found.kind === 'ambiguous') unresolved.push({ ean: clean, unresolved: 'ean_ambiguous', candidates: found.rows.map(row => row.sku) })
      else resolved.push({ ean: clean, match: found.kind, product: toProductView(found.row.product) })
    }

    return { resolved, unresolved }
  }

  private async productOrThrow(productId: number) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } })
    if (!product) throw new NotFoundException(`Product ${productId} not found`)

    return product
  }
}
