import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AttachProofDto, UpdatePendingTransactionDto } from '../dto/pending-import.dto'
import { PendingImportService } from '../services/pending-import.service'

/**
 * The review gate add-treasury-statement-ingestion adds. Nothing here is
 * reachable except through a `PendingImport` a parser already staged
 * (`createOrReplace`, called from the queue worker, not from HTTP) — this
 * controller only covers what a human reviewer does with what is already
 * staged: inspect it, correct it, resolve what the parser couldn't, and
 * confirm or reject.
 */
@ApiTags('treasury-imports')
@Controller('treasury/imports')
export class PendingImportController {
  constructor(private readonly imports: PendingImportService) {}

  @Get()
  @ApiOperation({ summary: 'List staged/confirmed/rejected imports' })
  list(@Query('period') period?: string) {
    return this.imports.list(period)
  }

  @Get(':id')
  @ApiOperation({ summary: 'One import, with its pending transactions and rejections' })
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.imports.getById(id)
  }

  @Patch(':id/transactions/:transactionId')
  @ApiOperation({ summary: "Correct a pending line's suggested classification before confirming" })
  updateTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Body() dto: UpdatePendingTransactionDto,
  ) {
    return this.imports.updateTransaction(id, transactionId, dto)
  }

  @Patch(':id/transactions/:transactionId/proof')
  @ApiOperation({
    summary: 'Attach a comprovante and resolve a payee the statement did not name',
    description: 'The Itaú SISPAG path — re-runs classification against the corrected favorecido.',
  })
  attachProof(
    @Param('id', ParseIntPipe) id: number,
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Body() dto: AttachProofDto,
  ) {
    return this.imports.attachProof(id, transactionId, dto)
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Convert every pending transaction into a real transaction, in one batch',
    description: 'Succeeds even with unresolved lines present — they become kind: pending, same as manual entry.',
  })
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.imports.confirm(id)
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Discard the pending transactions; keeps the import record and raw file for audit' })
  reject(@Param('id', ParseIntPipe) id: number) {
    return this.imports.reject(id)
  }
}
