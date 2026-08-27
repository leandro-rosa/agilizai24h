import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator'
import { MAPPING_KINDS, NATURES, type MappingKind, type Nature } from '../constants/treasury-vocabulary'

/**
 * A reviewer correcting a pending line before confirming
 * (add-treasury-review-ui reads/writes this; add-treasury-statement-
 * ingestion only defines the contract). Every field optional: a reviewer
 * usually corrects one thing, not the whole line.
 */
export class UpdatePendingTransactionDto {
  @ApiPropertyOptional({ enum: MAPPING_KINDS })
  @IsOptional()
  @IsIn(MAPPING_KINDS)
  suggested_kind?: MappingKind

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  suggested_category?: string

  @ApiPropertyOptional({ enum: NATURES })
  @IsOptional()
  @IsIn(NATURES)
  suggested_nature?: Nature

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  suggested_supplier_id?: number
}

/**
 * The Itaú SISPAG resolution path: no payee comes from the statement, so a
 * reviewer attaches the comprovante (already uploaded to object storage by
 * the gateway, same as any other raw file) and types who was paid.
 */
export class AttachProofDto {
  @ApiPropertyOptional({ description: 'Where the gateway stored the attached comprovante image.' })
  @IsString()
  proof_object_key: string

  @ApiPropertyOptional({ description: 'Corrected/typed favorecido, replacing the blank the statement carried.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  counterparty_raw?: string
}
