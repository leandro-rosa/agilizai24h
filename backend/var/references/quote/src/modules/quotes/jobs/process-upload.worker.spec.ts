import { Job } from 'bullmq'
import { QuoteJobEnvelope } from './quote-job-envelope'
import { ProcessUploadPayload } from './process-upload.producer'
import { ProcessUploadWorker } from './process-upload.worker'

describe('ProcessUploadWorker', () => {
  let s3Service: { getFile: jest.Mock }
  let quoteRepository: { findUnique: jest.Mock; update: jest.Mock }
  let quoteItemRepository: { create: jest.Mock }
  let activityService: { record: jest.Mock }
  let worker: ProcessUploadWorker

  beforeEach(() => {
    s3Service = { getFile: jest.fn() }
    quoteRepository = { findUnique: jest.fn(), update: jest.fn() }
    quoteItemRepository = { create: jest.fn() }
    activityService = { record: jest.fn() }
    worker = new ProcessUploadWorker(
      s3Service as any,
      quoteRepository as any,
      quoteItemRepository as any,
      activityService as any,
    )
  })

  function jobWith(envelope: unknown): Job<QuoteJobEnvelope<ProcessUploadPayload>> {
    return { data: envelope } as Job<QuoteJobEnvelope<ProcessUploadPayload>>
  }

  it('rejects a job carrying an unsupported schemaVersion instead of silently accepting it', async () => {
    const job = jobWith({
      schemaVersion: 2,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { sourceFileName: 'planilha.xlsx' },
    })

    await expect(worker.process(job)).rejects.toThrow(/Unsupported quote\.process-upload schemaVersion: 2/)
    expect(quoteRepository.findUnique).not.toHaveBeenCalled()
  })

  it('logs and returns without touching S3 when the quote no longer exists', async () => {
    quoteRepository.findUnique.mockResolvedValue(null)
    const job = jobWith({
      schemaVersion: 1,
      quoteId: 999,
      emittedAt: new Date().toISOString(),
      payload: { sourceFileName: 'planilha.xlsx' },
    })

    await expect(worker.process(job)).resolves.toBeUndefined()
    expect(s3Service.getFile).not.toHaveBeenCalled()
  })

  it('marks the quote failed when it has no associated file', async () => {
    quoteRepository.findUnique.mockResolvedValue({ id: 1, original_file_s3_key: null })
    const job = jobWith({
      schemaVersion: 1,
      quoteId: 1,
      emittedAt: new Date().toISOString(),
      payload: { sourceFileName: 'planilha.xlsx' },
    })

    await worker.process(job)

    expect(quoteRepository.update).toHaveBeenCalledWith(1, { status: 'failed' })
    expect(activityService.record).toHaveBeenCalledWith(1, 'processing_failed', expect.any(String))
  })
})
