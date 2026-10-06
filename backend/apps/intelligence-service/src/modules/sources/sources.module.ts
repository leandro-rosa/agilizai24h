import { Global, Module } from '@nestjs/common'
import { HttpClientModule } from '@app/http-client'
import { ProductsClient } from './products.client'
import { SalesClient } from './sales.client'
import { StoresClient } from './stores.client'
import { SuppliersClient } from './suppliers.client'
import { SupplyClient } from './supply.client'

/** The services the intelligence reads. Read-only by construction: these clients expose no write call. */
@Global()
@Module({
  imports: [HttpClientModule],
  providers: [SupplyClient, SalesClient, ProductsClient, StoresClient, SuppliersClient],
  exports: [SupplyClient, SalesClient, ProductsClient, StoresClient, SuppliersClient],
})
export class SourcesModule {}
