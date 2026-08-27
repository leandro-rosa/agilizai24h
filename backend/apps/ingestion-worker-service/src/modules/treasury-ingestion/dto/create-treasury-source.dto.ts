import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator'
import { TREASURY_SOURCES, type TreasurySource } from '@app/treasury-ingestion-contracts'

export class CreateTreasurySourceDto {
  @ApiProperty({ enum: TREASURY_SOURCES })
  @IsIn(TREASURY_SOURCES)
  source: TreasurySource

  @ApiProperty({ description: 'Where the gateway stored the raw upload.' })
  @IsString()
  @IsNotEmpty()
  object_key: string

  @ApiProperty({ description: 'Which BankAccount these rows belong to — stated by the uploader, never guessed.' })
  @IsInt()
  @Min(1)
  account_id: number

  @ApiProperty({ example: '2026-07' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlation_id?: string
}
