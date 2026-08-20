import { randomUUID } from 'node:crypto'
import { Injectable, NestMiddleware } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'

export const CORRELATION_ID_HEADER = 'x-correlation-id'

/**
 * Reuses an inbound correlation id when the caller supplies one, generates one
 * otherwise, and echoes it on the response. A single operator action can then
 * be followed across services.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'] & { correlationId?: string }, res: FastifyReply['raw'], next: () => void): void {
    const inbound = req.headers?.[CORRELATION_ID_HEADER]
    const correlationId = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID()

    req.correlationId = correlationId
    res.setHeader(CORRELATION_ID_HEADER, correlationId)

    next()
  }
}
