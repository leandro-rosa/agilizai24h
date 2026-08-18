import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '../auth/guards/session.constants'

/**
 * The gateway declares its own liveness instead of mounting @app/health's.
 *
 * That module's controller hardcodes a Postgres indicator, and terminus fails
 * the whole check when any indicator is down — so a service with no database
 * can never report healthy through it, however correct it is. The lib's own
 * docs say the indicator "degrades to down instead of crashing", which is true,
 * but the resulting 503 still makes the container permanently unhealthy.
 *
 * Rather than binding a fake Postgres client to satisfy a check this service
 * has no business passing, liveness here states what is actually true: the
 * process is up and serving. Upstream availability is deliberately NOT part of
 * it — a gateway that reports itself dead because a downstream is down would be
 * restarted by the orchestrator for someone else's outage, and it still has
 * useful work to do (returning honest 502s and serving /docs).
 */
@ApiTags('health')
@Controller('health')
export class GatewayHealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness — the gateway process is up and serving' })
  check() {
    return { status: 'ok', service: 'gateway-service' }
  }
}
