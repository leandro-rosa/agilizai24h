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
      storeId?: number
    } = {},
  ) => {
    const ingestions = {
      stageRows: jest.fn().mockResolvedValue(undefined),
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
          store_id: opts.storeId ?? 7,
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
