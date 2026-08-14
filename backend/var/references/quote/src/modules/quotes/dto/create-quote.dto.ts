import { IsIn, IsOptional, IsString } from 'class-validator'
import { QUOTE_STATUS_VALUES } from '../constants/vocabulary'

/**
 * Fields accompanying a multipart spreadsheet upload (POST /quotes) —
 * validated by hand in QuotesController since Fastify multipart parts
 * arrive as an async iterator, not a plain JSON body that ValidationPipe
 * can bind to. Kept here anyway as the single documented source of what's
 * required, mirrored by the controller's manual checks.
 */
export class CreateQuoteDto {
  @IsString()
  name!: string

  @IsOptional()
  @IsIn(QUOTE_STATUS_VALUES)
  status?: string
}
