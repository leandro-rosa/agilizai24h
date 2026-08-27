import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractPdfPages } from '../utils/pdf-text'
import { parsePagBankStatement } from './pagbank.parser'

/**
 * Runs the real `pdf-parse` extraction against a real PDF binary (see
 * test/fixtures/treasury/README.md — synthetic content, genuine PDF
 * mechanics), then the real parser on top. Every other parser test operates
 * on pre-extracted line arrays; this is the one place that proves the two
 * halves actually work together against real bytes, not just independently.
 */
describe('parsePagBankStatement (fixture)', () => {
  it('extracts and classifies every line of the sample PDF', async () => {
    const buffer = await readFile(
      join(__dirname, '../../../../test/fixtures/treasury/pagbank-sample.pdf'),
    )
    const pages = await extractPdfPages(buffer)
    const result = parsePagBankStatement(pages)

    expect(result.rejections).toEqual([])
    expect(result.rows).toHaveLength(4)

    expect(result.rows[0]).toMatchObject({
      occurredOn: '2026-07-05',
      amountCents: 123456,
      direction: 'outflow',
      counterpartyRaw: 'AMBEV',
    })
    expect(result.rows[0].structuralHint).toBeUndefined()

    expect(result.rows[1]).toMatchObject({
      amountCents: 350000,
      direction: 'outflow',
      structuralHint: { kind: 'movement', category: 'Pagamento de fatura' },
    })

    expect(result.rows[2]).toMatchObject({
      amountCents: 820000,
      direction: 'inflow',
      counterpartyRaw: 'AGILIZ.AI LTDA',
    })

    expect(result.rows[3]).toMatchObject({
      counterpartyRaw: 'POSTO IPIRANGA CENTRO',
      direction: 'outflow',
    })
  })
})
