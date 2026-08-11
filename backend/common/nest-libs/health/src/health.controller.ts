import { Controller, Get } from '@nestjs/common'
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'
import { PostgresHealthIndicator } from './custom/postgres.health'

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgresHealthIndicator: PostgresHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([() => this.postgresHealthIndicator.isHealthy('POSTGRES')])
  }
}
