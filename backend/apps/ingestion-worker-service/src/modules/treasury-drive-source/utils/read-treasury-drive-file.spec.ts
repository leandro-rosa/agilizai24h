import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { InMemoryDriveClient } from '../../drive-source/testing/in-memory-drive.client'
import { xlsxBuffer } from '../../drive-source/testing/workbook-fixtures'
import type { SheetRows } from '../../ingestion/utils/read-workbook-rows'
import { readAndClassifyTreasuryDriveFile } from './read-treasury-drive-file'

const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ENCRYPTED_PDF_FIXTURE = join(
  __dirname,
  '../../treasury-ingestion/utils/test/fixtures/encrypted-sample.pdf',
)

const PAGBANK_SHEET: SheetRows = {
  sheetName: 'Sheet1',
  rows: [
    ['Nome do Titular : AGILIZ.AI LTDA'],
    ['Banco : 290 - PagSeguro Internet S/A'],
    [],
    ['Data', 'Tipo', 'Descrição', 'Entradas', 'Saidas', 'Saldo'],
    ['01/09/2026', 'Vendas', 'Disponivel PIX', 5.86, null, null],
  ],
}

const C6_STATEMENT_SHEET: SheetRows = {
  sheetName: 'Sheet1',
  rows: [
    ['Data Lançamento', 'Data Contábil', 'Título', 'Descrição', 'Entrada(R$)', 'Saída(R$)', 'Tipo', 'Detalhe'],
    ['2026-08-03', '2026-08-03', 'Pix', 'Pix recebido', 445.93, 0, '', ''],
  ],
}

const UNENCRYPTED_NUBANK_LIKE_PDF = join(__dirname, 'test-fixtures-scratch-unencrypted.pdf')

describe('readAndClassifyTreasuryDriveFile', () => {
  afterAll(() => {
    try {
      unlinkSync(UNENCRYPTED_NUBANK_LIKE_PDF)
    } catch {
      // Not written yet if the test that writes it never ran — fine.
    }
  })

  it('reads a native Google Sheet via export, exactly as before', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'extrato', xlsxBuffer([C6_STATEMENT_SHEET]), true)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, GOOGLE_SHEET_MIME, 'c6', '/tmp/test-dest-1', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBe('c6_statement')
    expect(result.sheets).toBeDefined()
  })

  it('reads a real uploaded .xlsx file (not a native Sheet) by downloading and parsing the raw bytes', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'extrato.xlsx', xlsxBuffer([C6_STATEMENT_SHEET]), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, XLSX_MIME, 'c6', '/tmp/test-dest-2', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBe('c6_statement')
  })

  it('reads a file Drive reports as application/pdf whose real bytes are a zip/xlsx (the real PagSeguro case)', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'fake.pdf', xlsxBuffer([PAGBANK_SHEET]), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'pagseguro', '/tmp/test-dest-3', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBe('pagbank_statement')
  })

  it('reads a genuine unencrypted PDF with real Nubank-matching text and returns pages', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 120])
    page.drawText('AGILIZ.AI LTDA', { x: 10, y: 90 })
    page.drawText('60.819.321/0001-44 0001  CNPJ Agência Conta', { x: 10, y: 60 })
    page.drawText('Movimentações', { x: 10, y: 30 })
    writeFileSync(UNENCRYPTED_NUBANK_LIKE_PDF, Buffer.from(await doc.save()))

    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'extrato.pdf', readFileSync(UNENCRYPTED_NUBANK_LIKE_PDF), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'nubank', '/tmp/test-dest-4', 25 * 1024 * 1024, undefined)
    expect(result.pages).toBeDefined()
  })

  it('retries with the configured password when a PDF is password-protected, and succeeds', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'fatura.pdf', readFileSync(ENCRYPTED_PDF_FIXTURE), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'c6', '/tmp/test-dest-5', 25 * 1024 * 1024, 'test1234')
    expect(result.pages?.[0]?.lines.join(' ')).toContain('AGILIZ.AI LTDA fatura teste')
  })

  it('records a password-protected PDF as unrecognized when no password is configured, without throwing', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'fatura.pdf', readFileSync(ENCRYPTED_PDF_FIXTURE), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/pdf', 'c6', '/tmp/test-dest-6', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBeNull()
    expect(result.contentSha256).toBeTruthy()
  })

  it('records content matching neither zip nor PDF magic bytes as unrecognized, without throwing', async () => {
    const client = InMemoryDriveClient.fromTree('root', {})
    const fileId = client.addFile('root', 'random.bin', Buffer.from([0x00, 0x01, 0x02, 0x03]), false)

    const result = await readAndClassifyTreasuryDriveFile(client, fileId, 'application/octet-stream', 'itau', '/tmp/test-dest-7', 25 * 1024 * 1024, undefined)
    expect(result.detectedSource).toBeNull()
    expect(result.contentSha256).toBeTruthy()
  })
})
