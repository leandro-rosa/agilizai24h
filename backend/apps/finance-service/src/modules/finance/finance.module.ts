import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { FinanceController } from './controllers/finance.controller'
import { FinanceService } from './services/finance.service'
import { UpstreamClient } from './services/upstream.client'

/** Global so the worker, which lives in HoldItModule's own module, can inject these. */
@Global()
@Module({
  imports: [HttpClientModule],
  controllers: [FinanceController],
  providers: [FinanceService, UpstreamClient],
  exports: [FinanceService, UpstreamClient],
})
export class FinanceModule {}
