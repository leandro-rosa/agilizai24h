import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractPdfPages, PdfPasswordRequiredError } from './pdf-text'

const ENCRYPTED_FIXTURE = join(__dirname, 'test/fixtures/encrypted-sample.pdf')

describe('extractPdfPages', () => {
  it('throws PdfPasswordRequiredError when a password-protected PDF is read with no password', async () => {
    const buffer = readFileSync(ENCRYPTED_FIXTURE)
    await expect(extractPdfPages(buffer)).rejects.toBeInstanceOf(PdfPasswordRequiredError)
  })

  it('reads a password-protected PDF correctly when the right password is given', async () => {
    const buffer = readFileSync(ENCRYPTED_FIXTURE)
    const pages = await extractPdfPages(buffer, 'test1234')
    expect(pages.length).toBeGreaterThan(0)
    expect(pages[0].lines.join(' ')).toContain('AGILIZ.AI LTDA fatura teste')
  })

  it('throws a normal error (not PdfPasswordRequiredError) when the password is wrong', async () => {
    const buffer = readFileSync(ENCRYPTED_FIXTURE)
    await expect(extractPdfPages(buffer, 'wrong-password')).rejects.not.toBeInstanceOf(PdfPasswordRequiredError)
  })
})
