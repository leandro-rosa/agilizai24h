import { Injectable } from '@nestjs/common'
import { Processor } from '@nestjs/bullmq'
import { WorkerOptions } from 'bullmq'

export type HoldItProcessorOptions = Partial<Omit<WorkerOptions, 'connection'>>

/**
 * Marks a class as a hold-it BullMQ worker for the given queue.
 *
 * Combines @Injectable() and @nestjs/bullmq's @Processor() so consumers
 * only import from hold-it, never from @nestjs/bullmq directly. The queue
 * must be registered via HoldItModule.registerWorker() (or already
 * registered by HoldItModule.register() elsewhere in the app) — hold-it
 * does not auto-register queues from this decorator alone.
 */
export const HoldItProcessor = (queueName: string, options?: HoldItProcessorOptions): ClassDecorator => {
  return (target) => {
    Injectable()(target)
    Processor(queueName, options ?? {})(target)
  }
}
