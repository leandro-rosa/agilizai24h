import { StagedRowsWorker } from './staged-rows.worker'

const message = (rowData: Record<string, unknown>, rowId = 2) => ({
  rowData,
  requestId: 'ing-1',
  rowId,
  additionalData: { ingestionId: 'ing-1', fileType: 'sales' as const, worksheetName: 'Vendas' },
})

const jobOf = (messages: unknown[]) => ({ id: '1', data: messages }) as never

describe('StagedRowsWorker', () => {
  const build = (
    opts: {
      matched?: { source_name: string; product: { id: number; sku: string; name: string } }[]
      unmatched?: { source_name: string; reason: string }[]
      store?: { id: number; name: string; external_code: string | null } | null
      storeId?: number
    } = {},
  ) => {
    const ingestions = {
      stageRows: jest.fn().mockResolvedValue(undefined),
      recordRejections: jest.fn().mockResolvedValue(undefined),
      completeChunk: jest.fn().mockResolvedValue(false),
      finalize: jest.fn().mockResolvedValue(undefined),
    }
    const prisma = {
      ingestion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'ing-1',
          file_type: 'sales',
          store_id: opts.storeId ?? 7,
        }),
      },
    }
    const upstream = {
      resolveProductNames: jest.fn().mockResolvedValue({
        matched: opts.matched ?? [],
        unmatched: opts.unmatched ?? [],
      }),
      resolveStoreByExternalCode: jest.fn().mockResolvedValue(opts.store ?? null),
    }

    return {
      worker: new StagedRowsWorker(ingestions as never, prisma as never, upstream as never),
      ingestions,
      upstream,
    }
  }

  const knownProduct = [{ source_name: 'Guaraná', product: { id: 1, sku: 'GUA-350', name: 'Guaraná' } }]

  describe('unresolvable products', () => {
    it('rejects an unresolved product and reports the original name', async () => {
      // Reported rather than dropped: a dropped row makes the period's total
      // quietly too low, with nothing to indicate it.
      const { worker, ingestions } = build({
        unmatched: [{ source_name: 'Produto Fantasma', reason: 'unknown_name' }],
      })

      await worker.process(jobOf([message({ Produto: 'Produto Fantasma', Quantidade: 5 })]))

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [])
      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'unknown_name', detail: expect.stringContaining('Produto Fantasma') }),
      ])
    })

    it('carries the ambiguity reason through rather than flattening it', async () => {
      const { worker, ingestions } = build({
        unmatched: [{ source_name: 'Duplicado', reason: 'ambiguous_name' }],
      })

      await worker.process(jobOf([message({ Produto: 'Duplicado', Quantidade: 1 })]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'ambiguous_name' }),
      ])
    })

    it('names the row so the operator can find it in the file', async () => {
      const { worker, ingestions } = build({ unmatched: [{ source_name: 'X', reason: 'unknown_name' }] })

      await worker.process(jobOf([message({ Produto: 'X', Quantidade: 1 }, 42)]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ rowReference: 'Vendas!row 42' }),
      ])
    })

    it('rejects a row that names no product at all', async () => {
      const { worker, ingestions } = build()

      await worker.process(jobOf([message({ Quantidade: 5 })]))

      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ reason: 'missing_product' }),
      ])
    })

    it('stages the resolvable rows even when others are rejected', async () => {
      const { worker, ingestions } = build({
        matched: knownProduct,
        unmatched: [{ source_name: 'Fantasma', reason: 'unknown_name' }],
      })

      await worker.process(
        jobOf([message({ Produto: 'Guaraná', Quantidade: 3 }), message({ Produto: 'Fantasma', Quantidade: 1 }, 3)]),
      )

      expect(ingestions.stageRows).toHaveBeenCalledWith('ing-1', [
        expect.objectContaining({ sku: 'GUA-350', quantity: 3 }),
      ])
      expect(ingestions.recordRejections).toHaveBeenCalledWith('ing-1', [expect.objectContaining({ reason: 'unknown_name' })])
    })
  })

  describe('store cross-check', () => {
    it('does nothing when the file names no store', async () => {
      const { worker, upstream } = build({ matched: knownProduct })

      await worker.process(jobOf([message({ Produto: 'Guaraná', Quantidade: 1 })]))

      expect(upstream.resolveStoreByExternalCode).not.toHaveBeenCalled()
    })

    it('accepts a file whose store code matches the store it was uploaded against', async () => {
      const { worker } = build({
        matched: knownProduct,
        storeId: 7,
        store: { id: 7, name: 'Loja', external_code: 'TP-001' },
      })

      await expect(
        worker.process(jobOf([message({ Produto: 'Guaraná', Quantidade: 1, Loja: 'TP-001' })])),
      ).resolves.toBeDefined()
    })

    it('fails the chunk when the file belongs to a different store', async () => {
      // Nothing else catches a report filed against the wrong store, and every
      // figure derived from it would be attributed elsewhere while looking
      // entirely plausible.
      const { worker, ingestions } = build({
        matched: knownProduct,
        storeId: 7,
        store: { id: 99, name: 'Outra', external_code: 'TP-999' },
      })

      await expect(
        worker.process(jobOf([message({ Produto: 'Guaraná', Quantidade: 1, Loja: 'TP-999' })])),
      ).rejects.toThrow(/uploaded against store 7/)

      expect(ingestions.stageRows).not.toHaveBeenCalled()
    })

    it('fails the chunk when the file names a store code nothing matches', async () => {
      const { worker } = build({ matched: knownProduct, store: null })

      await expect(
        worker.process(jobOf([message({ Produto: 'Guaraná', Quantidade: 1, Loja: 'DESCONHECIDA' })])),
      ).rejects.toThrow(/matches no registered store/)
    })
  })

  describe('finalisation', () => {
    it('does not finalise while chunks remain', async () => {
      const { worker, ingestions } = build({ matched: knownProduct })

      await worker.process(jobOf([message({ Produto: 'Guaraná', Quantidade: 1 })]))

      expect(ingestions.finalize).not.toHaveBeenCalled()
    })

    it('finalises exactly once, on the chunk that completes the file', async () => {
      const { worker, ingestions } = build({ matched: knownProduct })
      ingestions.completeChunk.mockResolvedValue(true)

      await worker.process(jobOf([message({ Produto: 'Guaraná', Quantidade: 1 })]))

      expect(ingestions.finalize).toHaveBeenCalledTimes(1)
    })
  })
})
