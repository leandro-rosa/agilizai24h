import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { TreasuryRawRow, TreasuryRawRowsJob } from '@app/treasury-ingestion-contracts'
import type { CounterpartyMapping, Prisma } from '../../../../generated/prisma/client'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { normalizeCounterparty } from '../constants/treasury-vocabulary'
import type { AttachProofDto, UpdatePendingTransactionDto } from '../dto/pending-import.dto'
import { TreasuryService } from './treasury.service'

// Unchecked, not the default Checked variant: once `mapping_rule` exists as
// a relation, the Checked create input requires a nested `{ connect: { id } }`
// instead of a plain `mapping_rule_id` scalar — same reason `account_id`
// elsewhere in this service needs the Unchecked variant too.
type PendingTransactionCreateInput = Omit<Prisma.PendingTransactionUncheckedCreateWithoutPending_importInput, never>

/**
 * The review-gate state machine add-treasury-statement-ingestion adds:
 * `PendingImport` (staged → confirmed | rejected) and its `PendingTransaction`
 * rows. Owns nothing about file parsing — that is `ingestion-worker-service`'s
 * job. Owns nothing about the classification ALGORITHM either — that is
 * `TreasuryService.resolveMany` (add-treasury-classification-model);
 * this service only decides WHEN to call it and what state a line moves
 * through on the way to becoming a real `BankTransaction`.
 */
@Injectable()
export class PendingImportService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly treasury: TreasuryService,
  ) {}

  /**
   * Consumes a parsed file's raw rows (from `TREASURY_QUEUES.RAW_ROWS`) and
   * stages them, classified, for review.
   *
   * Re-uploading while the prior import for this account+period+source is
   * still `staged` REPLACES it (design D6) — the corrected file supersedes
   * the previous parse, never adds to it. Re-uploading after that import was
   * `confirmed` creates a NEW import instead, with each line checked against
   * already-confirmed transactions and flagged if it looks like the same
   * fact arriving twice.
   */
  async createOrReplace(job: TreasuryRawRowsJob): Promise<{ pendingImportId: number; replaced: boolean }> {
    const toResolve = job.rows.filter(row => !row.structuralHint).map(row => row.counterpartyRaw)
    const resolved = await this.treasury.resolveMany(toResolve)

    const classified = job.rows.map(row => this.classifyRow(row, resolved))
    const flagged = await this.flagLikelyDuplicates(job.accountId, job.period, classified)

    const stagedExisting = await this.prisma.pendingImport.findFirst({
      where: { account_id: job.accountId, period: job.period, source: job.source, status: 'staged' },
    })

    // Cascade delete removes its transactions/rejections too — replacing in
    // place, rather than updating, keeps this one code path for both the
    // "first upload" and "corrected re-upload while staged" cases.
    if (stagedExisting) {
      await this.prisma.pendingImport.delete({ where: { id: stagedExisting.id } })
    }

    const created = await this.prisma.pendingImport.create({
      data: {
        account_id: job.accountId,
        period: job.period,
        source: job.source,
        status: 'staged',
        object_key: job.objectKey,
        line_count: job.rows.length,
        rejected_line_count: job.rejections.length,
        transactions: { create: flagged },
        rejections: {
          create: job.rejections.map(rejection => ({
            row_reference: rejection.rowReference,
            reason: rejection.reason,
            detail: rejection.detail,
          })),
        },
      },
    })

    return { pendingImportId: created.id, replaced: Boolean(stagedExisting) }
  }

  list(period?: string) {
    return this.prisma.pendingImport.findMany({
      where: period ? { period } : {},
      orderBy: [{ period: 'desc' }, { id: 'desc' }],
    })
  }

  async getById(id: number) {
    const found = await this.prisma.pendingImport.findUnique({
      where: { id },
      include: {
        transactions: { orderBy: { id: 'asc' } },
        rejections: { orderBy: { id: 'asc' } },
      },
    })
    if (!found) throw new NotFoundException(`Pending import ${id} not found`)

    return found
  }

  async updateTransaction(importId: number, transactionId: number, dto: UpdatePendingTransactionDto) {
    const existing = await this.findOwnedTransaction(importId, transactionId)

    const kind = dto.suggested_kind ?? existing.suggested_kind ?? 'pending'
    return this.prisma.pendingTransaction.update({
      where: { id: transactionId },
      data: {
        ...dto,
        ...('suggested_kind' in dto || 'suggested_nature' in dto
          ? { suggested_nature: this.treasury.natureFor(kind, dto.suggested_nature ?? existing.suggested_nature ?? undefined) }
          : {}),
      },
    })
  }

  /**
   * The Itaú SISPAG resolution path. Re-runs classification against the
   * corrected favorecido: it may already match an existing mapping rule
   * (spec: "Attaching a comprovante resolves a SISPAG line" — resolving the
   * name is what clears the unresolved state, not the attachment alone).
   */
  async attachProof(importId: number, transactionId: number, dto: AttachProofDto) {
    const existing = await this.findOwnedTransaction(importId, transactionId)
    const counterpartyRaw = dto.counterparty_raw ?? existing.counterparty_raw

    let suggestion: Partial<
      Pick<
        Prisma.PendingTransactionUpdateInput,
        'suggested_kind' | 'suggested_entry_type' | 'suggested_category' | 'suggested_nature' | 'suggested_supplier_id'
      >
    > = {}

    if (dto.counterparty_raw) {
      const resolved = await this.treasury.resolveMany([counterpartyRaw])
      const rule = resolved.get(normalizeCounterparty(counterpartyRaw))
      if (rule) {
        suggestion = {
          suggested_kind: rule.kind,
          suggested_entry_type: rule.entry_type,
          suggested_category: rule.category,
          suggested_nature: this.treasury.natureFor(rule.kind, rule.nature ?? undefined),
          suggested_supplier_id: rule.supplier_id,
        }
      }
    }

    return this.prisma.pendingTransaction.update({
      where: { id: transactionId },
      data: {
        proof_object_key: dto.proof_object_key,
        ...(dto.counterparty_raw ? { counterparty_raw: dto.counterparty_raw } : {}),
        ...suggestion,
      },
    })
  }

  /**
   * Converts every pending transaction into a real `BankTransaction`, in one
   * batch — a partially-confirmed import must not leave some of a source's
   * lines counted and others not (mirrors add-ingestion-flow's D5 for the
   * same reason). Succeeds even with unresolved (`suggested_kind: pending`)
   * lines: `kind: pending` is already a first-class, dashboard-visible state
   * (add-treasury-classification-model) — this endpoint does not force
   * resolution first.
   */
  async confirm(importId: number): Promise<{ confirmed: number }> {
    const pendingImport = await this.prisma.pendingImport.findUnique({
      where: { id: importId },
      include: { transactions: true },
    })
    if (!pendingImport) throw new NotFoundException(`Pending import ${importId} not found`)
    if (pendingImport.status !== 'staged') {
      throw new ConflictException(`Import ${importId} is "${pendingImport.status}", not staged`)
    }

    await this.prisma.$transaction([
      ...pendingImport.transactions.map(transaction => {
        const kind = transaction.suggested_kind ?? 'pending'
        return this.prisma.bankTransaction.create({
          data: {
            account_id: pendingImport.account_id,
            occurred_on: transaction.occurred_on,
            period: pendingImport.period,
            direction: transaction.direction,
            amount_cents: transaction.amount_cents,
            counterparty_raw: transaction.counterparty_raw,
            supplier_id: transaction.suggested_supplier_id,
            entry_type: transaction.suggested_entry_type ?? 'a classificar',
            category: transaction.suggested_category ?? 'a classificar',
            kind,
            nature: this.treasury.natureFor(kind, transaction.suggested_nature ?? undefined),
            installment_index: transaction.installment_index,
            installment_total: transaction.installment_total,
            source_ref: transaction.source_ref,
            pending_import_id: pendingImport.id,
            mapping_rule_id: transaction.mapping_rule_id,
          },
        })
      }),
      this.prisma.pendingImport.update({ where: { id: importId }, data: { status: 'confirmed' } }),
    ])

    return { confirmed: pendingImport.transactions.length }
  }

  /** Discards the pending transactions; keeps the import record and the raw file for audit. */
  async reject(importId: number): Promise<void> {
    const pendingImport = await this.prisma.pendingImport.findUnique({ where: { id: importId } })
    if (!pendingImport) throw new NotFoundException(`Pending import ${importId} not found`)
    if (pendingImport.status !== 'staged') {
      throw new ConflictException(`Import ${importId} is "${pendingImport.status}", not staged`)
    }

    await this.prisma.$transaction([
      this.prisma.pendingTransaction.deleteMany({ where: { pending_import_id: importId } }),
      this.prisma.pendingImport.update({ where: { id: importId }, data: { status: 'rejected' } }),
    ])
  }

  // ----- privados -------------------------------------------------------

  private async findOwnedTransaction(importId: number, transactionId: number) {
    const existing = await this.prisma.pendingTransaction.findUnique({ where: { id: transactionId } })
    if (!existing || existing.pending_import_id !== importId) {
      throw new NotFoundException(`Pending transaction ${transactionId} not found on import ${importId}`)
    }

    return existing
  }

  /**
   * Structural hints (a fatura's own "Inclusão de Pagamento" section, e.g.)
   * bypass mapping resolution entirely — the file's format already answered
   * the question. Everything else goes through the same engine
   * add-treasury-classification-model exposes for applyMappings.
   */
  private classifyRow(row: TreasuryRawRow, resolved: Map<string, CounterpartyMapping>) {
    const rule = row.structuralHint ? undefined : resolved.get(normalizeCounterparty(row.counterpartyRaw))
    const structuralKind = row.structuralHint?.kind
    const kind = structuralKind ?? rule?.kind ?? 'pending'
    const category = row.structuralHint?.category ?? rule?.category ?? null

    const data: PendingTransactionCreateInput = {
      occurred_on: new Date(row.occurredOn),
      amount_cents: row.amountCents,
      direction: row.direction,
      counterparty_raw: row.counterpartyRaw,
      source_ref: row.sourceRef,
      installment_index: row.installmentIndex,
      installment_total: row.installmentTotal,
      suggested_kind: kind,
      suggested_entry_type: rule?.entry_type ?? (row.structuralHint ? category ?? undefined : undefined),
      suggested_category: category,
      suggested_nature: this.treasury.natureFor(kind, rule?.nature ?? undefined),
      suggested_supplier_id: rule?.supplier_id ?? null,
      // `rule` is already undefined for a structuralHint row (line above) —
      // this never fabricates a de-para link for a row a rule never touched.
      mapping_rule_id: rule?.id ?? null,
    }

    return data
  }

  private async flagLikelyDuplicates<T extends PendingTransactionCreateInput>(
    accountId: number,
    period: string,
    rows: T[],
  ): Promise<T[]> {
    const confirmed = await this.prisma.bankTransaction.findMany({
      where: { account_id: accountId, period },
      select: { id: true, occurred_on: true, amount_cents: true, counterparty_raw: true },
    })
    if (confirmed.length === 0) return rows

    const byKey = new Map(
      confirmed.map(transaction => [
        this.duplicateKey(transaction.occurred_on, transaction.amount_cents, transaction.counterparty_raw),
        transaction.id,
      ]),
    )

    return rows.map(row => {
      const key = this.duplicateKey(row.occurred_on as Date, row.amount_cents as number, row.counterparty_raw as string)
      const matchId = byKey.get(key)
      return matchId ? { ...row, likely_duplicate_of_id: matchId } : row
    })
  }

  private duplicateKey(occurredOn: Date, amountCents: number, counterpartyRaw: string): string {
    const date = occurredOn instanceof Date ? occurredOn.toISOString().slice(0, 10) : occurredOn
    return `${date}|${amountCents}|${normalizeCounterparty(counterpartyRaw)}`
  }
}
