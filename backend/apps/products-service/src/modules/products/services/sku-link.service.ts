import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { validateSameLink } from '../utils/sku-link'

@Injectable()
export class SkuLinkService {
  constructor(private readonly prisma: PrismaClientService) {}

  list() {
    return this.prisma.skuLink.findMany({ orderBy: { decided_at: 'desc' } })
  }

  /** Grava (ou troca) a decisão de um par. Os dois SKUs precisam existir no catálogo. */
  async decide(oldSku: string, newSku: string, decision: 'same' | 'different') {
    const found = await this.prisma.product.findMany({ where: { sku: { in: [oldSku, newSku] } }, select: { sku: true } })
    const have = new Set(found.map((p) => p.sku))
    for (const sku of [oldSku, newSku]) {
      if (!have.has(sku)) throw new NotFoundException(`SKU ${sku} não existe no catálogo`)
    }

    if (decision === 'same') {
      const error = validateSameLink(await this.prisma.skuLink.findMany(), oldSku, newSku)
      if (error) throw new BadRequestException(error)
    }

    return this.prisma.skuLink.upsert({
      where: { old_sku_new_sku: { old_sku: oldSku, new_sku: newSku } },
      create: { old_sku: oldSku, new_sku: newSku, decision },
      update: { decision, decided_at: new Date() },
    })
  }

  /** Desfaz uma decisão (volta a ser sugerido). */
  async remove(id: number) {
    const row = await this.prisma.skuLink.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`Vínculo ${id} não encontrado`)
    await this.prisma.skuLink.delete({ where: { id } })
  }
}
