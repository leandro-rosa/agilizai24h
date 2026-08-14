import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'

/** Mirrors frontend/src/domain/model.ts's OriginalField — order is structural. */
export class OriginalFieldDto {
  @IsString()
  key!: string

  @IsString()
  @MaxLength(200)
  value!: string
}

/** Mirrors frontend/src/domain/model.ts's ProductCandidate. */
export class ProductCandidateDto {
  @IsString()
  productId!: string

  @IsString()
  name!: string

  @IsString()
  brand!: string

  @IsString()
  category!: string

  @IsString()
  sku!: string

  @IsString()
  ean!: string

  @IsString()
  mainCode!: string

  @IsArray()
  @IsString({ each: true })
  oemCodes!: string[]

  @IsArray()
  @IsString({ each: true })
  tradeNumbers!: string[]

  @IsOptional()
  @IsString()
  image?: string

  @IsNumber()
  stock!: number

  @IsNumber()
  matchScore!: number

  @IsArray()
  @IsString({ each: true })
  matchReasons!: string[]
}

/**
 * One quote line as a partner-API caller submits it: only raw identifying
 * fields (`key` is expected to be one of the canonical vocabulary target
 * fields — sku/ean/main_code/oem/trade_number/name/brand, see
 * `utils/candidate-scoring.util.ts`'s MATCHABLE_TARGET_FIELDS), no
 * pre-computed candidates or score — the system finds and scores
 * candidates itself via the async quote<->search matching flow (see
 * `jobs/search-match-request.producer.ts`). At least one recognized field
 * must carry a non-empty value; `PartnerIntakeService` rejects a line that
 * has none (400), since an unmatchable item couldn't be searched for at
 * all.
 */
export class PartnerQuoteLineDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OriginalFieldDto)
  originalFields!: OriginalFieldDto[]
}

/**
 * Entry point for source='partner_api' quotes — creates the quote header
 * and, for each line, a QuoteItem pending asynchronous matching (see
 * backend/apps/quote/CLAUDE.md). Today's only caller is the local demo
 * script `pnpm seed:demo-partner-quotes`, since no real external partner
 * system exists in this repository — see the open question recorded in
 * frontend/docs/api-contracts.md.
 */
export class PartnerIntakeDto {
  @IsString()
  displayName!: string

  @IsString()
  partnerName!: string

  @IsString()
  externalId!: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PartnerQuoteLineDto)
  lines!: PartnerQuoteLineDto[]
}
