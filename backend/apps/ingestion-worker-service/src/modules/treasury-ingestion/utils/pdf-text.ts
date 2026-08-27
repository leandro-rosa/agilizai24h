import { PDFParse } from 'pdf-parse'

export interface PdfPage {
  pageNumber: number
  lines: string[]
}

/**
 * Extracts text per page, split into lines. The five treasury PDF sources
 * are bank-generated, not scanned — they carry a real text layer, so this is
 * text-layer extraction, never OCR.
 *
 * Verified against a real (locally generated) PDF during design: `pdf-parse`
 * preserves line breaks faithfully, including a concatenated "-R$1.234,56"
 * on one line and a spaced "-R$ 500,00" on the next — the two shapes
 * `findMoneyInText` (../utils/money.ts) has to tell apart.
 */
export async function extractPdfPages(buffer: Buffer): Promise<PdfPage[]> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.pages.map(page => ({
      pageNumber: page.num,
      lines: page.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0),
    }))
  } finally {
    await parser.destroy()
  }
}
