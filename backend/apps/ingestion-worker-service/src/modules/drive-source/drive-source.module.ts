import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DriveFilesController } from './controllers/drive-files.controller'
import { DRIVE_CONFIG, DRIVE_ENV_KEYS, loadDriveConfig, type DriveConfig } from './config/drive.config'
import { DriveFilesQueryService } from './services/drive-files-query.service'
import { DisabledDriveClient } from './services/disabled-drive.client'
import { DRIVE_CLIENT } from './services/drive-client'
import { DriveImportService } from './services/drive-import.service'
import { DriveSchedulerService } from './services/drive-scheduler.service'
import { DriveScanService } from './services/drive-scan.service'
import { DriveValidationService } from './services/drive-validation.service'
import { DriveProducer } from './services/drive.producer'
import { DriveRepository } from './services/drive.repository'
import { createGoogleDriveClient } from './services/google-drive.client'

/**
 * The Google Drive source (add-drive-ingestion-source). Global so the queue
 * workers, which live in HoldItModule's own module, can inject its services.
 *
 * Nothing here needs the Drive to be configured to LOAD: with no variables set
 * the client is a stub that says so, no schedule is registered, and the rest of
 * the service runs exactly as before.
 */
@Global()
@Module({
  controllers: [DriveFilesController],
  providers: [
    {
      provide: DRIVE_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DriveConfig =>
        loadDriveConfig(Object.fromEntries(DRIVE_ENV_KEYS.map(key => [key, config.get<string>(key)]))),
    },
    {
      provide: DRIVE_CLIENT,
      inject: [DRIVE_CONFIG],
      useFactory: (config: DriveConfig) => (config.enabled ? createGoogleDriveClient(config) : new DisabledDriveClient()),
    },
    DriveRepository,
    DriveProducer,
    DriveScanService,
    DriveSchedulerService,
    DriveValidationService,
    DriveImportService,
    DriveFilesQueryService,
  ],
  exports: [DRIVE_CONFIG, DRIVE_CLIENT, DriveRepository, DriveProducer, DriveScanService, DriveValidationService, DriveImportService],
})
export class DriveSourceModule {}
