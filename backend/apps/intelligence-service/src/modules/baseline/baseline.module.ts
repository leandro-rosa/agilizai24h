import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { BaselineImportService } from './baseline-import.service'
import { BaselineController } from './baseline.controller'
import { BaselineRepository } from './baseline.repository'
import { ProductPackagingWriter } from './product-packaging.writer'

@Global()
@Module({
  imports: [HttpClientModule],
  controllers: [BaselineController],
  providers: [BaselineRepository, BaselineImportService, ProductPackagingWriter],
  exports: [BaselineRepository],
})
export class BaselineModule {}
