import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Logger } from '@nestjs/common'
import { AppModule } from '../app.module'
import { PartnerIntakeService } from '../modules/quotes/services/partner-intake.service'
import { PartnerIntakeDto } from '../modules/quotes/dto/partner-intake.dto'

/**
 * Manual demo seed — `pnpm seed:demo-partner-quotes`. Replaces
 * frontend/src/domain/partner-quote-fixtures.ts's role as the source of
 * partner-origin demo data: instead of an in-memory fixture, this calls the
 * real POST /quotes/partner-intake endpoint so partner-origin quotes exist
 * as real backend rows, visible through GET /quotes and the review
 * endpoints like any other quote.
 *
 * Each line submits only raw identifying fields (`key` must be one of the
 * canonical vocabulary target fields — sku/ean/main_code/oem/trade_number/
 * name/brand, see `modules/quotes/utils/candidate-scoring.util.ts`'s
 * MATCHABLE_TARGET_FIELDS) — no pre-computed candidates or score. The
 * backend itself looks each item up against the real product-bundle
 * catalog via the async quote<->search matching flow (see
 * `modules/quotes/jobs/search-match-request.producer.ts`) and scores it;
 * whether a given line auto-approves, needs manual review, or comes back
 * unmatched now depends on what's actually indexed on the real cluster at
 * seed time, not on data baked into this script.
 *
 * No real external partner system exists in this repository — see the open
 * question recorded in frontend/docs/api-contracts.md.
 */
const DEMO_PARTNER_QUOTES: PartnerIntakeDto[] = [
  {
    displayName: 'Cotação Parceiro — Freios Dianteiros',
    partnerName: 'AutoParts Distribuidora',
    externalId: 'EXT-2026-001',
    lines: [
      {
        originalFields: [
          { key: 'main_code', value: 'DF4949S' },
          { key: 'name', value: 'Disco de freio ventilado 280mm' },
        ],
      },
    ],
  },
  {
    displayName: 'Cotação Parceiro — Motor e Transmissão',
    partnerName: 'Retífica Sul Peças',
    externalId: 'EXT-2026-002',
    lines: [
      {
        originalFields: [
          { key: 'main_code', value: '5521XS' },
          { key: 'name', value: 'Correia dentada' },
        ],
      },
      {
        originalFields: [
          { key: 'main_code', value: 'PECA-INEXISTENTE-001' },
          { key: 'name', value: 'Peça sem correspondência esperada no catálogo' },
        ],
      },
    ],
  },
  {
    displayName: 'Cotação Parceiro — Elétrica e Ignição',
    partnerName: 'ElectroMoto Componentes',
    externalId: 'EXT-2026-003',
    lines: [
      {
        originalFields: [
          { key: 'sku', value: 'BT-60550' },
          { key: 'name', value: 'Bateria 60Ah' },
        ],
      },
      {
        originalFields: [
          { key: 'name', value: 'Vela de Ignição Iridium IX' },
          { key: 'brand', value: 'NGK' },
        ],
      },
    ],
  },
]

async function run() {
  const logger = new Logger('SeedDemoPartnerQuotes')
  const app = await NestFactory.createApplicationContext(AppModule)

  try {
    const partnerIntakeService = app.get(PartnerIntakeService)
    for (const dto of DEMO_PARTNER_QUOTES) {
      const quote = await partnerIntakeService.intake(dto, 'demo-seed')
      logger.log({ id: quote.id, displayName: dto.displayName }, 'DEMO_PARTNER_QUOTE_CREATED')
    }
    logger.log('Matching runs asynchronously — check GET /quotes/:id/items shortly after this script exits.')
  } finally {
    await app.close()
  }
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
