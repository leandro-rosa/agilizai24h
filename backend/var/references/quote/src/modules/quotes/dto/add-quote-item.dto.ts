import { PartnerQuoteLineDto } from './partner-intake.dto'

/**
 * POST /:id/items body — same raw-field line shape as partner-intake's
 * `lines[]`, submitted one at a time against an already-existing
 * `source: partner_api` quote.
 */
export class AddQuoteItemDto extends PartnerQuoteLineDto {}
