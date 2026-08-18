import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { UpstreamStatusError, UpstreamUnreachableError } from '../modules/upstream/upstream.client'

/**
 * Turns an upstream failure into an honest status.
 *
 * A domain service's own 404 or 409 is forwarded as such — it is a real answer.
 * A service being unreachable becomes 502, never 401 or 403: the spec requires
 * that an upstream problem is never misreported as an authentication or
 * permission problem, because the panel reacts very differently to each.
 */
@Catch(UpstreamStatusError, UpstreamUnreachableError)
export class UpstreamExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(UpstreamExceptionFilter.name)

  catch(exception: UpstreamStatusError | UpstreamUnreachableError, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>()

    if (exception instanceof UpstreamStatusError) {
      const body = exception.body as { message?: unknown } | undefined

      void reply.status(exception.status).send({
        statusCode: exception.status,
        message: body?.message ?? `Upstream ${exception.service} responded ${exception.status}`,
        upstream: exception.service,
      })
      return
    }

    this.logger.error(`Upstream ${exception.service} unreachable`)

    void reply.status(HttpStatus.BAD_GATEWAY).send({
      statusCode: HttpStatus.BAD_GATEWAY,
      message: `Upstream ${exception.service} is unavailable`,
      upstream: exception.service,
    })
  }
}
