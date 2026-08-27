import { Global, Module } from '@nestjs/common'
import { PendingImportController } from './controllers/pending-import.controller'
import { TreasuryController } from './controllers/treasury.controller'
import { PendingImportService } from './services/pending-import.service'
import { TreasuryService } from './services/treasury.service'

/** Global so RawRowsWorker, which lives in HoldItModule's own dynamic module, can inject PendingImportService. */
@Global()
@Module({
  controllers: [TreasuryController, PendingImportController],
  providers: [TreasuryService, PendingImportService],
  exports: [TreasuryService, PendingImportService],
})
export class TreasuryModule {}
