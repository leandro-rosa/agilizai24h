import { StagedRowsWorker } from './staged-rows.worker'

const message = (rowData: Record<string, unknown>, rowId = 2) => ({
  rowData,
  requestId: 'ing-1',
  rowId,
  additionalData: { ingestionId: 'ing-1', fileType: 'sales' as const, worksheetName: 'Relatório' },
})

const jobOf = (messages: unknown[]) => ({ id: '1', data: messages }) as never

describe('StagedRowsWorker', () => {
  const build = (
    opts: {
      skuMatched?: { id: number; sku: string; name: string }[]
      skuUnmatched?: { sku: string; reason: string }[]
      nameMatched?: { source_name: string; product: { id: number; sku: string; name: string } }[]
      nameUnmatched?: { source_name: string; reason: string }[]
      storeId?: number | null
      /** Cliente (external code) -> resolved store id, or null for "does not resolve". */
      storesByExternalCode?: Record<string, number | null>
    } = {},
  ) => {
    const ingestions = {
      stageRows: jest.fn().mockResolvedValue(undefined),
      stageSalesTransactions: jest.fn().mockResolvedValue(undefined),
      recordRejections: jest.fn().mockResolvedValue(undefined),
      completeChunk: jest.fn().mockResolvedValue(false),
      finalize: jest.fn().mockResolvedValue(undefined),
      operationsFor: jest.fn().mockResolvedValue([]),
    }
    const prisma = {
      ingestion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ing-1',
          file_type: 'sales',
          store_id: opts.storeId === undefined ? 7 : opts.storeId,
        }),
      },
    }
    const upstream = {
      resolveSkus: jest.fn().mockResolvedValue({
        matched: opts.skuMatched ?? [],
        unmatched: opts.skuUnmatched ?? [],
      }),
      resolveProductNames: jest.fn().mockResolvedValue({
        matched: opts.nameMatched ?? [],
        unmatched: opts.nameUnmatched ?? [],
      }),
      resolveStoreByExternalCode: jest.fn(async (externalCode: string) => {
        const id = opts.storesByExternalCode?.[externalCode]
        return id ? { id, name: externalCode, external_code: externalCode } : null
      }),
    }

    return {
      worker: new StagedRowsWorker(ingestions as never, prisma as never, upstream as never),
      ingestions,
      upstream,
    }
  }

  const knownProductByCode = [{ id: 1, sku: 'GUA-350', name: 'Guaraná' }]
  const knownProductByName = [{ source_name: 'Guaraná', product: { id: 1, sku: 'GUA-350', name: 'Guaraná' } }]

  describe('product resolution — code first, name as fallback (design D3)', () => {
    it('resolves by code without ever calling name resolution', async () => {
      const { worker, ingestions, upstream } = build({ skuMatched: knownProductByCode })

      await worker.process(jobOf([message({ Codigo: 'GUA-350', Qtd_vendida: 3 })]))

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ sku: 'GUA-350', quantity: 3 }),
      ])
      expect(upstream.resolveProductNames).not.toHaveBeenCalled()
    })

    it('falls back to name resolution only when the row carries no code', async () => {
      const { worker, ingestions, upstream } = build({ nameMatched: knownProductByName })

      await worker.process(jobOf([message({ Descricao: 'Guaraná', Qtd_vendida: 3 })]))

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ sku: 'GUA-350', quantity: 3 }),
      ])
      expect(upstream.resolveSkus).not.toHaveBeenCalled()
    })

    it('rejects an unresolved code rather than re-resolving the row by its name', async () => {
      // A stated code that is wrong must not be silently overridden by
      // whatever the name happens to match (design D3, task 4.5).
      const { worker, ingestions, upstream } = build({
        skuUnmatched: [{ sku: 'GHOST-1', reason: 'unknown_sku' }],
        nameMatched: knownProductByName,
      })

      await worker.process(jobOf([message({ Codigo: 'GHOST-1', Descricao: 'Guaraná', Qtd_vendida: 3 })]))

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [])
      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'unknown_sku', detail: expect.stringContaining('GHOST-1') }),
      ])
      expect(upstream.resolveProductNames).not.toHaveBeenCalled()
    })

    it('carries the ambiguity reason through rather than flattening it', async () => {
      const { worker, ingestions } = build({
        nameUnmatched: [{ source_name: 'Duplicado', reason: 'ambiguous_name' }],
      })

      await worker.process(jobOf([message({ Descricao: 'Duplicado', Qtd_vendida: 1 })]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'ambiguous_name' }),
      ])
    })

    it('names the row so the operator can find it in the file', async () => {
      const { worker, ingestions } = build({ nameUnmatched: [{ source_name: 'X', reason: 'unknown_name' }] })

      await worker.process(jobOf([message({ Descricao: 'X', Qtd_vendida: 1 }, 42)]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ rowReference: 'Relatório!row 42' }),
      ])
    })

    it('rejects a row that names no product code or name at all', async () => {
      const { worker, ingestions } = build()

      await worker.process(jobOf([message({ Qtd_vendida: 5 })]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'missing_product' }),
      ])
    })

    it('stages the resolvable rows even when others are rejected', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        skuUnmatched: [{ sku: 'GHOST-1', reason: 'unknown_sku' }],
      })

      await worker.process(
        jobOf([
          message({ Codigo: 'GUA-350', Qtd_vendida: 3 }),
          message({ Codigo: 'GHOST-1', Qtd_vendida: 1 }, 3),
        ]),
      )

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ sku: 'GUA-350', quantity: 3 }),
      ])
      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'unknown_sku' }),
      ])
    })
  })

  describe('the network-wide sales format (Aug 2026) — per-row store resolution', () => {
    // Real column names, after smartChunk's slugification — "Cliente",
    // "Resultado", "Cód. produto" -> "Cod_produto", "Quantidade", "Valor
    // Pago" -> "Valor_Pago" (see row-mapping.spec.ts for the slugified
    // forms this mirrors).
    const networkRow = (overrides: Record<string, unknown> = {}, rowId?: number) =>
      message(
        {
          Cliente: 'Ascenty - JDI01',
          Resultado: 'OK',
          Cod_produto: 'GUA-350',
          Quantidade: 3,
          Valor_Pago: '12,50',
          ...overrides,
        },
        rowId,
      )

    it('is detected by the Cliente column and never touches the ingestion-level store_id', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(jobOf([networkRow()]))

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ storeId: 55, sku: 'GUA-350', quantity: 3 }),
      ])
    })

    it('resolves once per distinct Cliente value, not per row', async () => {
      const { worker, upstream } = build({
        skuMatched: [{ id: 1, sku: 'GUA-350', name: 'Guaraná' }, { id: 2, sku: 'COCA-350', name: 'Coca-Cola' }],
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(
        jobOf([
          networkRow({ Cod_produto: 'GUA-350' }, 1),
          networkRow({ Cod_produto: 'COCA-350' }, 2),
        ]),
      )

      expect(upstream.resolveStoreByExternalCode).toHaveBeenCalledTimes(1)
      expect(upstream.resolveStoreByExternalCode).toHaveBeenCalledWith('Ascenty - JDI01', undefined)
    })

    it('rejects only the row whose Cliente does not resolve, staging its resolvable siblings', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(
        jobOf([
          networkRow({ Cliente: 'Loja Fantasma Que Nao Existe' }, 1),
          networkRow({ Cliente: 'Ascenty - JDI01' }, 2),
        ]),
      )

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'unresolved_store', detail: expect.stringContaining('Loja Fantasma') }),
      ])
      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [expect.objectContaining({ storeId: 55 })])
    })

    it('excludes a non-OK Resultado from the aggregate and reports it, never silently dropping or including it', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(jobOf([networkRow({ Resultado: 'CANCELADO' })]))

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [])
      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'not_ok_result', detail: expect.stringContaining('CANCELADO') }),
      ])
    })

    it('also stages a non-OK but resolvable transaction for detail — the rejection above and this are not exclusive (add-sales-transaction-detail D4)', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(jobOf([networkRow({ Resultado: 'CANCELADO' })]))

      expect(ingestions.stageSalesTransactions).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ storeId: 55, sku: 'GUA-350', result: 'CANCELADO' }),
      ])
      // Still excluded from the aggregate — this table is additive, never a substitute.
      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [])
    })

    it('a non-OK row whose store also fails to resolve gets exactly one rejection, never a second on top of not_ok_result', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(jobOf([networkRow({ Resultado: 'CANCELADO', Cliente: 'Loja Fantasma Que Nao Existe' })]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'not_ok_result' }),
      ])
      expect(ingestions.stageSalesTransactions).toHaveBeenCalledWith('ing-1', [])
    })

    it('a non-OK row whose product also fails to resolve gets exactly one rejection, never a second on top of not_ok_result', async () => {
      const { worker, ingestions } = build({
        skuUnmatched: [{ sku: 'GUA-350', reason: 'unknown_sku' }],
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(jobOf([networkRow({ Resultado: 'CANCELADO' })]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'not_ok_result' }),
      ])
      expect(ingestions.stageSalesTransactions).toHaveBeenCalledWith('ing-1', [])
    })

    it('stages transaction detail for an OK row too, with every column buildTransactionDetail reads', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(
        jobOf([
          networkRow({
            Metodo: 'PIX',
            Adquirente: 'Stone',
            Bandeira: 'Visa',
            Final_cartao: '4321',
            Cod_interno: 'INT-9',
            Cod_adquirente: 'ACQ-9',
            Ponto_de_venda: 'PDV-01',
            Modelo_maq: 'TOTEM X1',
            Numero_comprador: '99',
            Valor_Original: '15,00',
            Desconto: '2,50',
            Liquido: '11,63',
            Cupom: '000456',
          }),
        ]),
      )

      expect(ingestions.stageSalesTransactions).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({
          storeId: 55,
          sku: 'GUA-350',
          result: 'OK',
          method: 'PIX',
          acquirer: 'Stone',
          netAmountCents: 1163,
          coupon: '000456',
          cardBrand: 'Visa',
          cardLastDigits: '4321',
          internalCode: 'INT-9',
          acquirerCode: 'ACQ-9',
          posId: 'PDV-01',
          machineModel: 'TOTEM X1',
          buyerNumber: '99',
          originalAmountCents: 1500,
          discountCents: 250,
        }),
      ])
      // Also staged to the aggregate, as before — additive, not a replacement.
      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [expect.objectContaining({ storeId: 55 })])
    })

    it('stages the same store+SKU appearing on several transaction rows as separate rows — summing is finalize()\'s job, not this worker\'s', async () => {
      const { worker, ingestions } = build({
        skuMatched: knownProductByCode,
        storesByExternalCode: { 'Ascenty - JDI01': 55 },
        storeId: null,
      })

      await worker.process(
        jobOf([
          networkRow({ Quantidade: 1, Valor_Pago: '7,90' }, 1),
          networkRow({ Quantidade: 1, Valor_Pago: '7,90' }, 2),
        ]),
      )

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ storeId: 55, sku: 'GUA-350', quantity: 1, amountCents: 790 }),
        expect.objectContaining({ storeId: 55, sku: 'GUA-350', quantity: 1, amountCents: 790 }),
      ])
    })

    it('the old format never calls store resolution — its store is the ingestion-level store_id', async () => {
      const { worker, upstream } = build({ skuMatched: knownProductByCode, storeId: 7 })

      await worker.process(jobOf([message({ Codigo: 'GUA-350', Qtd_vendida: 3 })]))

      expect(upstream.resolveStoreByExternalCode).not.toHaveBeenCalled()
    })
  })

  describe('finalisation', () => {
    it('does not finalise while chunks remain', async () => {
      const { worker, ingestions } = build({ skuMatched: knownProductByCode })

      await worker.process(jobOf([message({ Codigo: 'GUA-350', Qtd_vendida: 1 })]))

      expect(ingestions.finalize).not.toHaveBeenCalled()
    })

    it('finalises exactly once, on the chunk that completes the file', async () => {
      const { worker, ingestions } = build({ skuMatched: knownProductByCode })
      ingestions.completeChunk.mockResolvedValue(true)

      await worker.process(jobOf([message({ Codigo: 'GUA-350', Qtd_vendida: 1 })]))

      expect(ingestions.finalize).toHaveBeenCalledTimes(1)
    })
  })
})
