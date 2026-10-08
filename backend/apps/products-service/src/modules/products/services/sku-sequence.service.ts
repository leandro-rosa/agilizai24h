import { ConflictException, Injectable } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { SIX_DIGIT_SKU, type NextSku } from '../utils/next-sku'

export const SKU_MAX = 999_999
/** More collisions than this in a row means the sequence is walking through a block of codes someone typed in by hand: stop instead of looping. */
const MAX_SKIPS = 10_000

const pad = (value: number) => String(value).padStart(6, '0')

/**
 * The automatic SKU. A single persistent counter (`sku_sequence`), advanced with one atomic `UPDATE … RETURNING`, so two simultaneous registrations
 * always receive different numbers. It never goes back: a deleted product's SKU is not reused, and a number taken for a registration that then failed
 * stays a gap. A SKU typed by hand or brought by an import above the counter moves the counter up, so the automatic sequence never runs into it.
 */
@Injectable()
export class SkuSequenceService {
  constructor(private readonly prisma: PrismaClientService) {}

  /** Takes the next number, definitively. Skips any code already used by a product (an imported or typed SKU the counter had not reached yet). */
  async allocate(): Promise<string> {
    for (let attempt = 0; attempt < MAX_SKIPS; attempt++) {
      const rows = await this.prisma.$queryRaw<{ last_value: number }[]>`
        UPDATE sku_sequence SET last_value = last_value + 1, updated_at = now() WHERE id = 1 AND last_value < ${SKU_MAX} RETURNING last_value`
      if (rows.length === 0) throw new ConflictException('A faixa de SKUs automáticos de 6 dígitos acabou: informe o código à mão')

      const sku = pad(rows[0].last_value)
      if (!(await this.prisma.product.findUnique({ where: { sku }, select: { id: true } }))) return sku
    }

    throw new ConflictException('Não foi possível encontrar um SKU livre na sequência: informe o código à mão')
  }

  /** A SKU that arrived from outside (form, spreadsheet): when it is six digits above the counter, the counter moves up to it. Never lowers it. */
  async observe(sku: string): Promise<void> {
    if (!SIX_DIGIT_SKU.test(sku)) return
    await this.prisma.$executeRaw`UPDATE sku_sequence SET last_value = GREATEST(last_value, ${Number(sku)}), updated_at = now() WHERE id = 1`
  }

  /**
   * The number the next registration will probably get, shown BEFORE saving. It is a forecast: nothing is reserved, and another registration may take
   * it first. The definitive number is given on save.
   */
  async forecast(): Promise<NextSku> {
    const [row] = await this.prisma.$queryRaw<{ last_value: number }[]>`SELECT last_value FROM sku_sequence WHERE id = 1`
    const last = row?.last_value ?? 100_112
    const used = new Set(
      (await this.prisma.$queryRaw<{ sku: string }[]>`SELECT sku FROM product WHERE sku ~ '^[0-9]{6}$' AND sku::integer > ${last} ORDER BY sku LIMIT ${MAX_SKIPS}`).map(r => Number(r.sku)),
    )
    let next = last + 1
    while (used.has(next)) next++

    return { suggested: next <= SKU_MAX ? pad(next) : null, highest: pad(last), suggestion: true, forecast: true }
  }
}
