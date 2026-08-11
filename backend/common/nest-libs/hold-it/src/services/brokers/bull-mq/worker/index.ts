import { Logger } from '@nestjs/common'
import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { HoldItSimpleJobDataDTO } from '../../../../dto/hold-it-message'

/**
 * Base class for hold-it BullMQ workers.
 *
 * Consumers subclass this and implement `process()`; queue registration,
 * concurrency and worker options are declared with `@HoldItProcessor(...)`
 * on the subclass. Graceful shutdown of the underlying BullMQ Worker is
 * already handled by @nestjs/bullmq's own discovery service on
 * application shutdown — this class does not need to reimplement it.
 */
export abstract class HoldItWorkerHost<T = HoldItSimpleJobDataDTO> extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name)

  abstract process(job: Job<T>, token?: string): Promise<unknown>

  @OnWorkerEvent('failed')
  onFailed(job: Job<T> | undefined, error: Error): void {
    this.logger.error(
      {
        jobId: job?.id,
        queue: job?.queueName,
        attemptsMade: job?.attemptsMade,
        message: error.message,
      },
      error.stack,
      'HOLD_IT_JOB_FAILED',
    )
  }
}
