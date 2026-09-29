import { Global, Module } from '@nestjs/common'
import { TreasuryDriveFilesController } from './controllers/treasury-drive-files.controller'
import { TREASURY_DRIVE_CONFIG, loadTreasuryDriveConfig } from './config/treasury-drive.config'
import { TreasuryDriveImportService } from './services/treasury-drive-import.service'
import { TreasuryDriveProducer } from './services/treasury-drive.producer'
import { TreasuryDriveRepository } from './services/treasury-drive.repository'
import { TreasuryDriveScanService } from './services/treasury-drive-scan.service'

/**
 * The treasury Drive source (Itaú/C6 bank statement and invoice files) — see the workspace
 * `backend/apps/ingestion-worker-service/CLAUDE.md` for the fourth-family pipeline this feeds.
 *
 * `@Global()` for the exact same reason `DriveSourceModule` is: `TreasuryDriveScanWorker` and
 * `TreasuryDriveImportWorker` (Tasks 8–9) are registered as providers via
 * `HoldItModule.registerWorker()` in `app.module.ts` — a separate dynamic module from this one —
 * and their constructors need `TREASURY_DRIVE_CONFIG`/`TreasuryDriveScanService`/
 * `TreasuryDriveImportService` injectable from there too. The workers themselves are
 * deliberately NOT listed as providers here, mirroring how `DriveScanWorker`/`DriveImportWorker`/
 * `DriveValidateWorker` are never providers of `DriveSourceModule` either — every worker in this
 * service is registered in the one `HoldItModule.registerWorker({ processors: [...] })` call in
 * `app.module.ts`, so that list stays the single place to look for "what BullMQ workers does this
 * service run".
 *
 * `TREASURY_DRIVE_CONFIG` reads `process.env` directly rather than via `ConfigService` (unlike
 * `DRIVE_CONFIG`'s own factory): `loadTreasuryDriveConfig` already accepts a plain
 * `Record<string, unknown>`, and every variable it reads (`TREASURY_DRIVE_ROOT_FOLDER_ID`,
 * `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`/`_FILE`, `TREASURY_DRIVE_MONTH_FOLDERS`,
 * `TREASURY_DRIVE_SCAN_CRON`) is a real process env var, never something injected only through
 * Nest's `ConfigService` — so there is no `TREASURY_DRIVE_ENV_KEYS` allowlist to keep in sync.
 *
 * The scheduler that keeps the daily scan registered (mirroring `DriveSchedulerService`) is
 * Task 11 — not wired in yet. Until then, only "Sincronizar agora" (`POST /scan`) can trigger a
 * scan.
 */
@Global()
@Module({
  controllers: [TreasuryDriveFilesController],
  providers: [
    {
      provide: TREASURY_DRIVE_CONFIG,
      useFactory: () => loadTreasuryDriveConfig(process.env),
    },
    TreasuryDriveRepository,
    TreasuryDriveProducer,
    TreasuryDriveScanService,
    TreasuryDriveImportService,
  ],
  exports: [TREASURY_DRIVE_CONFIG, TreasuryDriveRepository, TreasuryDriveProducer, TreasuryDriveScanService, TreasuryDriveImportService],
})
export class TreasuryDriveSourceModule {}
