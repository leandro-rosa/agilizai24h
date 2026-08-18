import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { INGESTION_FILE_TYPES, type IngestionFileType } from '../constants/file-types'
import { IngestionService } from '../services/ingestion.service'

export class CreateIngestionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string

  @ApiProperty({ enum: INGESTION_FILE_TYPES })
  @IsIn(INGESTION_FILE_TYPES)
  file_type: IngestionFileType

  @ApiProperty({ description: 'Where the gateway stored the raw upload.' })
  @IsString()
  @IsNotEmpty()
  object_key: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  original_name: string

  @ApiProperty({ description: 'Stated by the uploader — never inferred from the file.' })
  @IsInt()
  store_id: number

  @ApiProperty({ example: '2026-03' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  correlation_id?: string
}

/**
 * Internal API. The gateway owns the browser-facing upload route and calls
 * here once it has stored the file; this service owns ingestion state so it
 * lives in one place.
 */
@ApiTags('ingestions')
@Controller('ingestions')
export class IngestionController {
  constructor(private readonly ingestions: IngestionService) {}

  @Post()
  @ApiOperation({
    summary: 'Register an uploaded file and queue it for parsing',
    description: 'Returns immediately — parsing never happens on the request path.',
  })
  create(@Body() dto: CreateIngestionDto) {
    return this.ingestions.create({
      id: dto.id,
      fileType: dto.file_type,
      objectKey: dto.object_key,
      originalName: dto.original_name,
      storeId: dto.store_id,
      period: dto.period,
      correlationId: dto.correlation_id,
    })
  }

  @Get()
  @ApiOperation({ summary: 'Recent ingestions' })
  list(@Query('limit') limit?: string) {
    return this.ingestions.listRecent(limit ? Number(limit) : undefined)
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One ingestion status, with its rejected rows',
    description: 'Partial success is reported as partially_completed, never as completed.',
  })
  findById(@Param('id') id: string) {
    return this.ingestions.findById(id)
  }
}
