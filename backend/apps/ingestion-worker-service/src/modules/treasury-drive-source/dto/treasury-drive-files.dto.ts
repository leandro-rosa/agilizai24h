import { IsBoolean, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator'

/**
 * Confirmed at import time by whoever is operating `/treasury-imports`: the treasury Drive
 * source has no separate validation step to derive these from (see the module's own doc
 * comment) — `accountId`/`period` travel from this body straight into the queued job envelope
 * (`TreasuryDriveImportJobEnvelope`), unchanged, same as `ImportDriveFileDto`'s own fields do
 * for the sibling Drive source.
 */
export class ImportTreasuryDriveFileDto {
  @IsInt()
  @Min(1)
  accountId: number

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  period: string
}

export class IgnoreTreasuryDriveFileDto {
  @IsOptional()
  @IsBoolean()
  ignored?: boolean
}
