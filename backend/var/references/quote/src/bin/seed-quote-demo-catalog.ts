import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { AppModule } from '../app.module'
import { ProductCatalogSeedService } from '../modules/product-catalog-seed/product-catalog-seed.service'

/**
 * Manual, idempotent seed runner — `pnpm seed:quote-demo-catalog`. Not run
 * automatically on `docker compose up` (see product-catalog-seed/CLAUDE.md):
 * keeps local startup fast and avoids masking a broken seed behind "it
 * always re-seeds itself".
 */
async function run() {
  const logger = new Logger('SeedQuoteDemoCatalog')
  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const seedService = app.get(ProductCatalogSeedService)
    const result = await seedService.run()
    logger.log(result, 'QUOTE_DEMO_CATALOG_SEED_DONE')
  } finally {
    await app.close()
  }
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
