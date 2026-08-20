import { ConflictException, Injectable, MethodNotAllowedException, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { SupplierRepository } from '../../db-client/repositories/supplier.repository'
import {
  DEFAULT_LISTED_STATUSES,
  normalizeAlias,
  type SupplierCategory,
  type SupplierStatus,
} from '../constants/supplier-vocabulary'

export interface SupplierView {
  id: number
  name: string
  legal_name: string | null
  tax_id: string | null
  category: string
  contact_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  status: string
  alias_count?: number
}

export interface AliasView {
  id: number
  alias: string
  normalized_alias: string
}

export interface CreateSupplierInput {
  name: string
  legal_name?: string
  tax_id?: string
  category: SupplierCategory
  contact_name?: string
  phone?: string
  email?: string
  notes?: string
}

export interface UpdateSupplierInput extends Partial<CreateSupplierInput> {
  status?: SupplierStatus
}

export interface ListSuppliersFilter {
  status?: SupplierStatus[]
  category?: SupplierCategory
  search?: string
}

export interface ResolveResult {
  matched: { name: string; normalized: string; supplier: SupplierView }[]
  unmatched: string[]
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly suppliers: SupplierRepository,
    private readonly prisma: PrismaClientService,
  ) {}

  async create(input: CreateSupplierInput): Promise<SupplierView> {
    if (input.tax_id) await this.assertTaxIdAvailable(input.tax_id)

    const created = await this.prisma.supplier.create({ data: { ...input, status: 'active' } })

    // O próprio nome vira o primeiro alias: sem isso um fornecedor recém
    // cadastrado não resolve contra o extrato que motivou o cadastro.
    await this.addAliasIfFree(created.id, created.name)

    return this.toView(created)
  }

  async update(id: number, input: UpdateSupplierInput): Promise<SupplierView> {
    const existing = await this.prisma.supplier.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Supplier ${id} not found`)

    if (input.tax_id) await this.assertTaxIdAvailable(input.tax_id, id)

    const updated = await this.prisma.supplier.update({ where: { id }, data: input })

    return this.toView(updated)
  }

  async findById(id: number): Promise<SupplierView & { aliases: AliasView[] }> {
    const supplier = await this.suppliers.findWithAliases(id)
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`)

    return {
      ...this.toView(supplier),
      aliases: supplier.aliases.map(a => ({
        id: a.id,
        alias: a.alias,
        normalized_alias: a.normalized_alias,
      })),
    }
  }

  async list(filter: ListSuppliersFilter = {}): Promise<SupplierView[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        status: { in: filter.status?.length ? filter.status : DEFAULT_LISTED_STATUSES },
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' as const } } : {}),
      },
      include: { _count: { select: { aliases: true } } },
      // Determinístico: `name` sozinho reordena homônimos, `id` desempata.
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })

    return suppliers.map(s => ({ ...this.toView(s), alias_count: s._count.aliases }))
  }

  async addAlias(supplierId: number, alias: string): Promise<AliasView> {
    await this.findById(supplierId)

    const normalized = normalizeAlias(alias)
    if (!normalized) throw new ConflictException('Alias vazio depois de normalizado')

    const owner = await this.prisma.supplierAlias.findUnique({ where: { normalized_alias: normalized } })
    if (owner) {
      // Um alias apontando para dois fornecedores é a falha que faz a
      // conciliação atribuir compra ao fornecedor errado — recusa explícita.
      throw new ConflictException(
        `Alias "${alias}" já resolve para o fornecedor ${owner.supplier_id}`,
      )
    }

    const created = await this.prisma.supplierAlias.create({
      data: { supplier_id: supplierId, alias, normalized_alias: normalized },
    })

    return { id: created.id, alias: created.alias, normalized_alias: created.normalized_alias }
  }

  async removeAlias(supplierId: number, aliasId: number): Promise<void> {
    const alias = await this.prisma.supplierAlias.findUnique({ where: { id: aliasId } })
    if (!alias || alias.supplier_id !== supplierId) {
      throw new NotFoundException(`Alias ${aliasId} not found for supplier ${supplierId}`)
    }

    await this.prisma.supplierAlias.delete({ where: { id: aliasId } })
  }

  /**
   * Casa grafias de extrato contra o cadastro. Devolve os dois lados: o que
   * resolveu e o que não. O não-resolvido é a lista de trabalho de quem
   * concilia — engolir isso silenciosamente esconde compra não classificada.
   */
  async resolve(names: string[]): Promise<ResolveResult> {
    const bySupplier = await this.suppliers.resolveByAliases(names)

    const matched: ResolveResult['matched'] = []
    const unmatched: string[] = []

    for (const name of names) {
      const normalized = normalizeAlias(name)
      const supplier = bySupplier.get(normalized)

      if (supplier) matched.push({ name, normalized, supplier: this.toView(supplier) })
      else unmatched.push(name)
    }

    return { matched, unmatched }
  }

  /**
   * Recusado: lançamento de tesouraria e item de investimento guardam
   * `supplier_id`, e eles precisam continuar resolvendo depois que a relação
   * com o fornecedor termina. Inativar é a operação equivalente.
   */
  delete(): never {
    throw new MethodNotAllowedException(
      'Fornecedores não são excluídos — use status "inactive", para lançamentos históricos seguirem resolvendo',
    )
  }

  private async addAliasIfFree(supplierId: number, alias: string): Promise<void> {
    const normalized = normalizeAlias(alias)
    if (!normalized) return

    const taken = await this.prisma.supplierAlias.findUnique({ where: { normalized_alias: normalized } })
    if (taken) return

    await this.prisma.supplierAlias.create({
      data: { supplier_id: supplierId, alias, normalized_alias: normalized },
    })
  }

  private async assertTaxIdAvailable(taxId: string, exceptId?: number): Promise<void> {
    // Verificado explicitamente, não por captura de violação de unique: o
    // PrismaRepository relança um Error genérico e perde o código do Prisma.
    // A constraint do banco segue como rede de segurança para a corrida.
    const owner = await this.prisma.supplier.findUnique({ where: { tax_id: taxId } })

    if (owner && owner.id !== exceptId) {
      throw new ConflictException(`CNPJ ${taxId} já pertence ao fornecedor ${owner.id}`)
    }
  }

  private toView(supplier: SupplierView): SupplierView {
    return {
      id: supplier.id,
      name: supplier.name,
      legal_name: supplier.legal_name,
      tax_id: supplier.tax_id,
      category: supplier.category,
      contact_name: supplier.contact_name,
      phone: supplier.phone,
      email: supplier.email,
      notes: supplier.notes,
      status: supplier.status,
    }
  }
}
