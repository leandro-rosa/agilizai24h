import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client'
import type { Supplier, SupplierAlias } from '../../../../generated/prisma/client'
import { normalizeAlias } from '../../suppliers/constants/supplier-vocabulary'
import { PrismaClientService } from '../prisma-client.service'

export type SupplierWithAliases = Supplier & { aliases: SupplierAlias[] }

@Injectable()
export class SupplierRepository extends PrismaRepository<Supplier, Supplier> {
  constructor(private readonly prismaClient: PrismaClientService) {
    super(prismaClient, prismaClient.supplier, 'Supplier')
  }

  /**
   * Resolve grafias em lote. Uma consulta com `in` em vez de N consultas:
   * a conciliação de um extrato chega com centenas de linhas de uma vez, e
   * uma ida ao banco por linha é o que torna a tela inutilizável.
   */
  async resolveByAliases(names: string[]): Promise<Map<string, Supplier>> {
    const normalized = [...new Set(names.map(normalizeAlias))].filter(Boolean)
    if (normalized.length === 0) return new Map()

    const rows = await this.prismaClient.supplierAlias.findMany({
      where: { normalized_alias: { in: normalized } },
      include: { supplier: true },
    })

    return new Map(rows.map(row => [row.normalized_alias, row.supplier]))
  }

  async findWithAliases(id: number): Promise<SupplierWithAliases | null> {
    return this.prismaClient.supplier.findUnique({
      where: { id },
      include: { aliases: { orderBy: { alias: 'asc' } } },
    })
  }
}
