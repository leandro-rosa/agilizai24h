import { Logger } from '@nestjs/common'
import { S3Service } from '@app/aws'
import { HoldItBullMQBroker } from '@app/hold-it'
import { TREASURY_QUEUES, type TreasurySource, type TreasuryRawRejection, type TreasuryRawRow } from '@app/treasury-ingestion-contracts'

export interface SourceParseJob {
  objectKey: string
  accountId: number
  period: string
  correlationId?: string
}

export interface ParseOutcome {
  rows: TreasuryRawRow[]
  rejections: TreasuryRawRejection[]
}

/**
 * Shared body every per-source worker calls: download the raw file, hand its
 * bytes to the source's own parser, publish exactly one job to the shared
 * sink queue. One function instead of six copies — the six workers differ
 * only in which parser they call and whether that parser wants text or a
 * Buffer.
 *
 * Never chunked into multiple jobs: a monthly statement is hundreds of
 * lines, not thousands, so there is none of the multi-batch-clobbers-itself
 * risk `add-ingestion-flow` has to guard against for the sales/supply
 * workbooks.
 */
export async function runParseJob(
  logger: Logger,
  s3: S3Service,
  broker: HoldItBullMQBroker,
  source: TreasurySource,
  job: SourceParseJob,
  parse: (fileBuffer: Buffer) => Promise<ParseOutcome> | ParseOutcome,
): Promise<{ rows: number; rejections: number }> {
  const { body } = await s3.getFile(job.objectKey)
  const { rows, rejections } = await parse(body)

  logger.log(
    `${source}: parsed ${rows.length} row(s), ${rejections.length} rejection(s) from ${job.objectKey}` +
      (job.correlationId ? ` [correlation ${job.correlationId}]` : ''),
  )

  await broker.holdIt({
    queueName: TREASURY_QUEUES.RAW_ROWS,
    message: {
      schemaVersion: 1 as const,
      correlationId: job.correlationId,
      source,
      accountId: job.accountId,
      period: job.period,
      objectKey: job.objectKey,
      rows,
      rejections,
    },
    options: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  })

  return { rows: rows.length, rejections: rejections.length }
}
