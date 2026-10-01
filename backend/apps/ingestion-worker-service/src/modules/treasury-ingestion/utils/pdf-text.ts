import { PDFParse, PasswordException } from 'pdf-parse'

export interface PdfPage {
  pageNumber: number
  lines: string[]
}

/** Thrown when a PDF cannot be read because it requires a password that wasn't given. */
export class PdfPasswordRequiredError extends Error {
  constructor() {
    super('This PDF requires a password to read')
    this.name = 'PdfPasswordRequiredError'
  }
}

function isPasswordRequiredError(error: unknown): boolean {
  return error instanceof PasswordException
}

/**
 * Extracts text per page, split into lines. The treasury PDF sources are bank-generated, not
 * scanned — they carry a real text layer, so this is text-layer extraction, never OCR.
 *
 * `password` is only ever supplied by the Drive-sourced import path (a real C6 invoice PDF found
 * in the "Extratos" folder is password-protected — confirmed against the real file during design;
 * the manually-uploaded PDF path never passes one, since an operator uploading by hand already has
 * the file open and readable before choosing to upload it).
 */
export async function extractPdfPages(buffer: Buffer, password?: string): Promise<PdfPage[]> {
  const parser = new PDFParse({ data: buffer, password })
  try {
    const result = await parser.getText()
    return result.pages.map(page => ({
      pageNumber: page.num,
      lines: page.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0),
    }))
  } catch (error) {
    if (password === undefined && isPasswordRequiredError(error)) throw new PdfPasswordRequiredError()
    throw error
  } finally {
    await parser.destroy()
  }
}
