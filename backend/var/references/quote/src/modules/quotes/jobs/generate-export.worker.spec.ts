import { Job } from 'bullmq'
import { QuoteJobEnvelope } from './quote-job-envelope'
import { GenerateExportPayload } from './generate-export.producer'
import { GenerateExportWorker, buildExportRow, rawInputToRow } from './generate-export.worker'

describe('rawInputToRow', () => {
  it('passes a spreadsheet-shaped rawInput (flat object) through unchanged', () => {
    expect(rawInputToRow({ sku: 'ABC-123', descricao: 'Filtro' })).toEqual({ sku: 'ABC-123', descricao: 'Filtro' })
  })

  it('flattens a partner-API-shaped rawInput (array of {key,value}) into a flat object', () => {
    expect(rawInputToRow([{ key: 'sku', value: 'OC90' }, { key: 'name', value: 'Filtro' }])).toEqual({
      sku: 'OC90',
      name: 'Filtro',
    })
  })

  it('returns an empty object for null/undefined rawInput', () => {
    expect(rawInputToRow(null)).toEqual({})
    expect(rawInputToRow(undefined)).toEqual({})
  })
})

describe('buildExportRow', () => {
  const baseItem = {
    id: 1,
    quote_id: 1,
    row_number: 1,
    raw_input: { sku: 'ABC-123' },
    match_score: 87,
    review_status: 'reviewed',
    review_decision: 'approved',
    reviewed_by: 'ana@empresa.com',
    reviewed_at: new Date('2026-08-06T10:00:00.000Z'),
    candidates: [{ productId: 'p-1', name: 'Filtro Snapshot', brand: 'Bosch', sku: 'SKU-SNAP', ean: '789', mainCode: 'MC-1', stock: 3 }],
    selected_candidate_id: 'p-1',
  }

  it('always keeps the original rawInput columns', () => {
    const row = buildExportRow(baseItem, ['product_name'], undefined)
    expect(row.sku).toBe('ABC-123')
  })

  it('populates quote-local review fields directly from the item, no catalog fetch needed', () => {
    const row = buildExportRow(baseItem, ['match_score', 'review_status', 'review_decision', 'reviewed_by', 'reviewed_at'], undefined)
    expect(row).toMatchObject({
      match_score: 87,
      review_status: 'reviewed',
      review_decision: 'approved',
      reviewed_by: 'ana@empresa.com',
      reviewed_at: '2026-08-06T10:00:00.000Z',
    })
  })

  it('extracts catalog-backed fields from a freshly-fetched product when available', () => {
    const fetched = { id: 1, product_name: 'Filtro Real', brand_mapped_name: 'Bosch Real' }
    const row = buildExportRow(baseItem, ['product_name', 'brand_name'], fetched)
    expect(row).toMatchObject({ product_name: 'Filtro Real', brand_name: 'Bosch Real' })
  })

  it('falls back to the stored candidate snapshot when no fresh product was fetched', () => {
    const row = buildExportRow(baseItem, ['product_name', 'brand_name', 'product_sku', 'stock_total'], undefined)
    expect(row).toMatchObject({
      product_name: 'Filtro Snapshot',
      brand_name: 'Bosch',
      product_sku: 'SKU-SNAP',
      stock_total: 3,
    })
  })

  it('leaves a catalog field with no snapshot equivalent blank on fallback, instead of throwing', () => {
    const row = buildExportRow(baseItem, ['normalized_sku', 'applications'], undefined)
    expect(row).toMatchObject({ normalized_sku: '', applications: '' })
  })

  it('skips an unrecognized field id instead of writing garbage', () => {
    const row = buildExportRow(baseItem, ['some_removed_field_id'], undefined)
    expect(row).not.toHaveProperty('some_removed_field_id')
  })

  it('populates a custom attribute column from a freshly-fetched product, combining value and unit', () => {
    const fetched = {
      id: 1,
      mapped_attributes: {
        peso_liquido: { golden_record: { value: 1.5 } },
        peso_liquido_unidade: { golden_record: { value: 'kg' } },
      },
    }
    const row = buildExportRow(baseItem, [], fetched, [
      { label: 'Peso líquido', attribute_key: 'peso_liquido', unit_attribute_key: 'peso_liquido_unidade' },
    ])
    expect(row['Peso líquido']).toBe('1.5 kg')
  })

  it('adds one column per custom attribute row, independent of the static field list', () => {
    const fetched = {
      id: 1,
      mapped_attributes: {
        cor: { golden_record: { value: 'Preto' } },
        material: { golden_record: { value: 'Aço' } },
      },
    }
    const row = buildExportRow(baseItem, ['product_name'], fetched, [
      { label: 'Cor', attribute_key: 'cor' },
      { label: 'Material', attribute_key: 'material' },
    ])
    expect(row).toMatchObject({ Cor: 'Preto', Material: 'Aço' })
  })

  it('leaves a custom attribute column blank when no fresh product was fetched — no snapshot fallback', () => {
    const row = buildExportRow(baseItem, [], undefined, [{ label: 'Cor', attribute_key: 'cor' }])
    expect(row.Cor).toBe('')
  })
})

describe('GenerateExportWorker', () => {
  let quoteRepository: { findUnique: jest.Mock; update: jest.Mock }
  let quoteItemRepository: { findAll: jest.Mock }
  let quoteExportRepository: { findUnique: jest.Mock; update: jest.Mock }
  let s3Service: { uploadFile: jest.Mock }
  let activityService: { record: jest.Mock }
  let searchCatalogService: { getProductsByIds: jest.Mock }
  let worker: GenerateExportWorker

  beforeEach(() => {
    quoteRepository = { findUnique: jest.fn(), update: jest.fn() }
    quoteItemRepository = { findAll: jest.fn().mockResolvedValue([]) }
    quoteExportRepository = {
      findUnique: jest.fn().mockResolvedValue({
        id: 1,
        quote_id: 1,
        format: 'xlsx',
        selected_fields: ['match_score'],
        custom_attribute_fields: [],
        file_s3_key: null,
        expires_at: null,
      }),
      update: jest.fn(),
    }
    s3Service = { uploadFile: jest.fn().mockResolvedValue(undefined) }
    activityService = { record: jest.fn() }
    searchCatalogService = { getProductsByIds: jest.fn().mockResolvedValue([]) }
    worker = new GenerateExportWorker(
      quoteRepository as any,
      quoteItemRepository as any,
      quoteExportRepository as any,
      s3Service as any,
      activityService as any,
      searchCatalogService as any,
    )
  })

  function jobWith(envelope: unknown): Job<QuoteJobEnvelope<GenerateExportPayload>> {
    return { data: envelope } as Job<QuoteJobEnvelope<GenerateExportPayload>>
  }

  it('rejects a job carrying an unsupported schemaVersion instead of silently accepting it', async () => {
    const job = jobWith({ schemaVersion: 2, quoteId: 1, emittedAt: new Date().toISOString(), payload: { exportId: 1 } })

    await expect(worker.process(job)).rejects.toThrow(/Unsupported quote\.generate-export schemaVersion: 2/)
  })

  it('logs and returns without touching S3 when the export record no longer exists', async () => {
    quoteExportRepository.findUnique.mockResolvedValue(null)
    const job = jobWith({ schemaVersion: 1, quoteId: 1, emittedAt: new Date().toISOString(), payload: { exportId: 999 } })

    await worker.process(job)

    expect(s3Service.uploadFile).not.toHaveBeenCalled()
  })

  it('does not call the catalog service when every selected field is quote-local', async () => {
    quoteExportRepository.findUnique.mockResolvedValue({ id: 1, quote_id: 1, format: 'xlsx', selected_fields: ['match_score', 'review_status'] })
    quoteItemRepository.findAll.mockResolvedValue([
      { id: 1, quote_id: 1, row_number: 1, raw_input: {}, candidates: [], selected_candidate_id: null },
    ])
    const job = jobWith({ schemaVersion: 1, quoteId: 1, emittedAt: new Date().toISOString(), payload: { exportId: 1 } })

    await worker.process(job)

    expect(searchCatalogService.getProductsByIds).not.toHaveBeenCalled()
    expect(quoteItemRepository.findAll).toHaveBeenCalledWith({ where: { quote_id: 1 }, orderBy: { row_number: 'asc' } })
    expect(quoteExportRepository.update).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'completed' }))
  })

  it('fetches products in one bulk call when a catalog-backed field is selected', async () => {
    quoteExportRepository.findUnique.mockResolvedValue({ id: 1, quote_id: 1, format: 'xlsx', selected_fields: ['product_name'] })
    quoteItemRepository.findAll.mockResolvedValue([
      { id: 1, quote_id: 1, row_number: 1, raw_input: {}, candidates: [{ productId: '1' }], selected_candidate_id: '1' },
      { id: 2, quote_id: 1, row_number: 2, raw_input: {}, candidates: [{ productId: '2' }], selected_candidate_id: '2' },
    ])
    const job = jobWith({ schemaVersion: 1, quoteId: 1, emittedAt: new Date().toISOString(), payload: { exportId: 1 } })

    await worker.process(job)

    expect(searchCatalogService.getProductsByIds).toHaveBeenCalledTimes(1)
    expect(searchCatalogService.getProductsByIds).toHaveBeenCalledWith(['1', '2'])
  })

  it('fetches products when only custom attribute fields are configured, even with no static selected field', async () => {
    quoteExportRepository.findUnique.mockResolvedValue({
      id: 1,
      quote_id: 1,
      format: 'xlsx',
      selected_fields: [],
      custom_attribute_fields: [{ label: 'Cor', attribute_key: 'cor' }],
    })
    quoteItemRepository.findAll.mockResolvedValue([
      { id: 1, quote_id: 1, row_number: 1, raw_input: {}, candidates: [{ productId: '1' }], selected_candidate_id: '1' },
    ])
    const job = jobWith({ schemaVersion: 1, quoteId: 1, emittedAt: new Date().toISOString(), payload: { exportId: 1 } })

    await worker.process(job)

    expect(searchCatalogService.getProductsByIds).toHaveBeenCalledTimes(1)
    expect(searchCatalogService.getProductsByIds).toHaveBeenCalledWith(['1'])
  })

  it('marks the export failed instead of throwing when generation errors out', async () => {
    quoteExportRepository.findUnique.mockResolvedValue({ id: 1, quote_id: 1, format: 'xlsx', selected_fields: ['match_score'] })
    quoteItemRepository.findAll.mockRejectedValue(new Error('db down'))
    const job = jobWith({ schemaVersion: 1, quoteId: 1, emittedAt: new Date().toISOString(), payload: { exportId: 1 } })

    await worker.process(job)

    expect(quoteExportRepository.update).toHaveBeenCalledWith(1, { status: 'failed' })
  })

  it('uploads to S3 and records activity on success', async () => {
    quoteItemRepository.findAll.mockResolvedValue([
      {
        id: 1,
        quote_id: 1,
        row_number: 1,
        raw_input: {},
        match_score: 90,
        candidates: [],
        selected_candidate_id: null,
      },
    ])
    const job = jobWith({ schemaVersion: 1, quoteId: 1, emittedAt: new Date().toISOString(), payload: { exportId: 1 } })

    await worker.process(job)

    expect(s3Service.uploadFile).toHaveBeenCalledWith(
      'quotes/1/exports/1.xlsx',
      expect.any(Buffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(quoteExportRepository.update).toHaveBeenCalledWith(1, {
      status: 'completed',
      file_s3_key: 'quotes/1/exports/1.xlsx',
      expires_at: expect.any(Date),
    })
    expect(activityService.record).toHaveBeenCalledWith(1, 'export_generated', expect.any(String))
  })
})
