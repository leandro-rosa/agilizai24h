import { Type } from 'class-transformer'
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator'

/**
 * Deliberately loose: the type and the period are checked by the service, which
 * answers with a `code` the admin can react to. A stricter pipe here would answer
 * with a differently shaped 400 for the same mistake.
 */
export class ConfirmValidationDto {
  @IsString()
  content_sha256: string
}

export class ImportDriveFileDto {
  @IsString()
  file_type: string

  @IsString()
  period: string

  @IsOptional()
  @IsBoolean()
  confirm_replace?: boolean

  @IsOptional()
  @ValidateNested()
  @Type(() => ConfirmValidationDto)
  confirm_validation?: ConfirmValidationDto

  /** Filled in by the gateway from the session; never trusted from a browser. */
  @IsOptional()
  @IsString()
  confirmed_by?: string
}

export class ValidateDriveFileDto {
  @IsOptional()
  @IsString()
  file_type?: string

  @IsOptional()
  @IsString()
  period?: string
}

export class IgnoreDriveFileDto {
  @IsOptional()
  @IsBoolean()
  ignored?: boolean
}

export class ListDriveFilesQueryDto {
  /** Comma-separated statuses, e.g. `new,changed`. */
  @IsOptional()
  @IsString()
  status?: string
}
