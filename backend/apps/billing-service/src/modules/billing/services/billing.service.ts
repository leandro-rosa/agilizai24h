import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import {
  AGING_BUCKETS,
  agingBucket,
  daysOverdue,
  dueDate,
  revenueShareCents,
  type AgingBucketKey,
} from '../constants/billing-vocabulary'
import type {
  CreateClientDto,
  CreateContractDto,
  CreateInvoiceDto,
  CreateSiteDto,
  ListInvoicesDto,
  UpdateClientDto,
  UpdateContractDto,
  UpdateInvoiceDto,
  UpdateSiteDto,
  UpsertRevenueShareDto,
} from '../dto/billing.dto'

export interface AgingBucketView {
  key: AgingBucketKey
  label: string
  invoice_count: number
  amount_cents: number
}

export interface AgingView {
  reference_date: string
  open_amount_cents: number
  overdue_amount_cents: number
  buckets: AgingBucketView[]
}

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaClientService) {}

  // ----- clientes e unidades ------------------------------------------------

  listClients(status?: string) {
    return this.prisma.client.findMany({
      where: { status: status ?? 'active' },
      include: { _count: { select: { sites: true, contracts: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
  }

  async findClient(id: number) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { sites: { orderBy: { code: 'asc' } } },
    })
    if (!client) throw new NotFoundException(`Client ${id} not found`)

    return client
  }

  async createClient(dto: CreateClientDto) {
    const taken = await this.prisma.client.findUnique({ where: { tax_id: dto.tax_id } })
    if (taken) throw new ConflictException(`CNPJ ${dto.tax_id} já pertence ao cliente ${taken.id}`)

    return this.prisma.client.create({ data: { ...dto, status: 'active' } })
  }

  async updateClient(id: number, dto: UpdateClientDto) {
    await this.findClient(id)

    if (dto.tax_id) {
      const taken = await this.prisma.client.findUnique({ where: { tax_id: dto.tax_id } })
      if (taken && taken.id !== id) throw new ConflictException(`CNPJ ${dto.tax_id} já pertence ao cliente ${taken.id}`)
    }

    return this.prisma.client.update({ where: { id }, data: dto })
  }

  async createSite(clientId: number, dto: CreateSiteDto) {
    await this.findClient(clientId)

    const taken = await this.prisma.clientSite.findUnique({
      where: { client_id_code: { client_id: clientId, code: dto.code } },
    })
    if (taken) throw new ConflictException(`Unidade ${dto.code} já existe para este cliente`)

    return this.prisma.clientSite.create({ data: { ...dto, client_id: clientId } })
  }

  async updateSite(clientId: number, siteId: number, dto: UpdateSiteDto) {
    const site = await this.prisma.clientSite.findUnique({ where: { id: siteId } })
    if (!site || site.client_id !== clientId) {
      throw new NotFoundException(`Site ${siteId} not found for client ${clientId}`)
    }

    return this.prisma.clientSite.update({ where: { id: siteId }, data: dto })
  }

  // ----- contratos ----------------------------------------------------------

  listContracts(clientId?: number, status?: string) {
    return this.prisma.contract.findMany({
      where: {
        ...(clientId !== undefined ? { client_id: clientId } : {}),
        ...(status ? { status } : {}),
      },
      include: { client: true, stores: true },
      orderBy: [{ starts_on: 'desc' }, { id: 'desc' }],
    })
  }

  async findContract(id: number) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: { client: true, stores: true },
    })
    if (!contract) throw new NotFoundException(`Contract ${id} not found`)

    return contract
  }

  async createContract(dto: CreateContractDto) {
    await this.findClient(dto.client_id)

    const { store_ids: storeIds = [], ...rest } = dto
    const taken = await this.prisma.contract.findUnique({
      where: { client_id_reference: { client_id: dto.client_id, reference: dto.reference } },
    })
    if (taken) throw new ConflictException(`Contrato "${dto.reference}" já existe para este cliente`)

    return this.prisma.contract.create({
      data: {
        ...rest,
        starts_on: new Date(dto.starts_on),
        ends_on: dto.ends_on ? new Date(dto.ends_on) : null,
        status: 'active',
        stores: { create: storeIds.map(store_id => ({ store_id })) },
      },
      include: { stores: true },
    })
  }

  async updateContract(id: number, dto: UpdateContractDto) {
    await this.findContract(id)
    const { store_ids: storeIds, ...rest } = dto

    return this.prisma.$transaction(async tx => {
      if (storeIds) {
        // Substitui a cobertura inteira em vez de somar: um contrato que
        // perdeu uma loja precisa deixar de cobri-la, e um PATCH que só
        // acrescenta nunca conseguiria expressar isso.
        await tx.contractStore.deleteMany({ where: { contract_id: id } })
        await tx.contractStore.createMany({ data: storeIds.map(store_id => ({ contract_id: id, store_id })) })
      }

      return tx.contract.update({
        where: { id },
        data: {
          ...rest,
          ...(dto.starts_on ? { starts_on: new Date(dto.starts_on) } : {}),
          ...(dto.ends_on ? { ends_on: new Date(dto.ends_on) } : {}),
        },
        include: { stores: true },
      })
    })
  }

  // ----- notas fiscais ------------------------------------------------------

  listInvoices(filter: ListInvoicesDto) {
    return this.prisma.invoice.findMany({
      where: {
        ...(filter.client_id !== undefined ? { client_id: filter.client_id } : {}),
        ...(filter.period ? { period: filter.period } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: { client: true },
      orderBy: [{ issued_on: 'desc' }, { id: 'desc' }],
    })
  }

  async createInvoice(dto: CreateInvoiceDto) {
    await this.findClient(dto.client_id)

    const taken = await this.prisma.invoice.findUnique({ where: { number: dto.number } })
    if (taken) throw new ConflictException(`NF ${dto.number} já existe`)

    // O prazo cai para o do contrato quando não vier explícito — é onde ele
    // está negociado, e repetir 30 no formulário convida a divergir dele.
    let term = dto.payment_term_days
    if (term === undefined && dto.contract_id) {
      const contract = await this.findContract(dto.contract_id)
      term = contract.payment_term_days
    }
    term ??= 30

    const issuedOn = new Date(dto.issued_on)

    return this.prisma.invoice.create({
      data: {
        ...dto,
        issued_on: issuedOn,
        payment_term_days: term,
        due_on: dueDate(issuedOn, term),
        status: 'issued',
      },
    })
  }

  async updateInvoice(id: number, dto: UpdateInvoiceDto) {
    const existing = await this.prisma.invoice.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Invoice ${id} not found`)

    const issuedOn = dto.issued_on ? new Date(dto.issued_on) : existing.issued_on
    const term = dto.payment_term_days ?? existing.payment_term_days

    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.issued_on ? { issued_on: issuedOn } : {}),
        ...(dto.paid_on ? { paid_on: new Date(dto.paid_on) } : {}),
        // Recalculado sempre que emissão ou prazo mudam: due_on é derivado,
        // e deixá-lo defasado quebraria o aging em silêncio.
        due_on: dueDate(issuedOn, term),
      },
    })
  }

  async markPaid(id: number, paidOn: string) {
    return this.updateInvoice(id, { status: 'paid', paid_on: paidOn })
  }

  /**
   * A receber por faixa de atraso.
   *
   * "Vencido" é derivado aqui, não lido de uma coluna: como status persistido
   * precisaria de um job diário mudando linha, e o número passaria a depender
   * de ele ter rodado. A planilha só tem PAGO/CANCELADA e por isso não
   * enxerga o vencido.
   */
  async aging(reference = new Date()): Promise<AgingView> {
    const open = await this.prisma.invoice.findMany({
      where: { status: 'issued', paid_on: null },
      select: { amount_cents: true, due_on: true },
    })

    const totals = new Map<AgingBucketKey, { count: number; amount: number }>()
    let openAmount = 0
    let overdueAmount = 0

    for (const invoice of open) {
      openAmount += invoice.amount_cents

      const key = agingBucket(invoice.due_on, reference)
      const bucket = totals.get(key) ?? { count: 0, amount: 0 }
      bucket.count += 1
      bucket.amount += invoice.amount_cents
      totals.set(key, bucket)

      if (daysOverdue(invoice.due_on, reference) > 0) overdueAmount += invoice.amount_cents
    }

    return {
      reference_date: reference.toISOString().slice(0, 10),
      open_amount_cents: openAmount,
      overdue_amount_cents: overdueAmount,
      buckets: AGING_BUCKETS.map(b => ({
        key: b.key,
        label: b.label,
        invoice_count: totals.get(b.key)?.count ?? 0,
        amount_cents: totals.get(b.key)?.amount ?? 0,
      })),
    }
  }

  // ----- repasse ------------------------------------------------------------

  listRevenueShares(period?: string) {
    return this.prisma.revenueShare.findMany({
      where: period ? { period } : {},
      orderBy: [{ period: 'desc' }, { store_id: 'asc' }],
    })
  }

  async upsertRevenueShare(dto: UpsertRevenueShareDto) {
    const contract = await this.findContract(dto.contract_id)

    // O percentual cai para o do contrato quando não vier: é onde ele está
    // negociado, e digitar de novo a cada mês é como a planilha diverge.
    const rate = dto.rate_bps ?? contract.revenue_share_bps
    const data = {
      contract_id: dto.contract_id,
      store_id: dto.store_id,
      period: dto.period,
      base_revenue_cents: dto.base_revenue_cents,
      rate_bps: rate,
      amount_cents: revenueShareCents(dto.base_revenue_cents, rate),
    }

    return this.prisma.revenueShare.upsert({
      where: { store_id_period: { store_id: dto.store_id, period: dto.period } },
      create: data,
      update: data,
    })
  }
}
