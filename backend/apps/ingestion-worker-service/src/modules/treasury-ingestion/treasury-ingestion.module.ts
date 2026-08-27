import { Module } from '@nestjs/common'
import { AwsModule } from '@app/aws'
import { TreasuryIngestionController } from './controllers/treasury-ingestion.controller'

@Module({
  imports: [AwsModule],
  controllers: [TreasuryIngestionController],
})
export class TreasuryIngestionModule {}
