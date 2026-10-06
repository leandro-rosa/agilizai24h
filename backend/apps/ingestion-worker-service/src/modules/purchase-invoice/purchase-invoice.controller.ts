import { Body, Controller, HttpCode, Post, UnprocessableEntityException } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'
import { NotAnNfeError, parseNfe } from './nfe.parser'

export class ParseInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5_000_000)
  xml: string
}

/**
 * Stateless: reads one NF-e and returns what it says. Nothing is stored here — the operator confirms the (resolved) lines in the
 * panel, and only then does purchasing record a purchase. The raw file is kept by the gateway before this is called.
 */
@ApiTags('purchase-invoices')
@Controller('purchase-invoices')
export class PurchaseInvoiceController {
  @Post('parse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Parse an NF-e XML into issuer, number, date and items', description: 'Rejects (422) anything that is not a readable NF-e instead of guessing.' })
  @ApiResponse({ status: 422, description: 'Not an NF-e, or missing what a purchase needs' })
  parse(@Body() dto: ParseInvoiceDto) {
    try {
      return parseNfe(dto.xml)
    } catch (error) {
      if (error instanceof NotAnNfeError) throw new UnprocessableEntityException(error.message)
      throw error
    }
  }
}
