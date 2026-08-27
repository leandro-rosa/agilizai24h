/**
 * Brazilian-formatted money parsing, shared by every treasury parser.
 *
 * Named specifically after a real bug finance already hit: a negative value
 * written with NO SPACE between the sign and the currency mark ("-R$150,00")
 * was not captured by the original PagBank extraction, because the naive
 * regex assumed a space always separated them. Every parser here goes
 * through this one function so that bug cannot recur independently in five
 * different places.
 */

/** `1.234,56` → `123456`. Thousands separator (`.`) is optional; decimal comma is not. */
export function parseBrlAmountToCents(numberText: string): number | null {
  const cleaned = numberText.trim()
  const match = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(cleaned)
  if (!match) return null

  const [, integerPart, centsPart] = match
  const digits = integerPart.replace(/\./g, '')
  return Number(digits) * 100 + Number(centsPart)
}

export interface FoundMoney {
  amountCents: number
  /** `true` when the line reads as a negative value (outflow-shaped), regardless of any separate "tipo" column. */
  negative: boolean
}

/**
 * Finds a `R$`-prefixed amount anywhere in a line, sign included, with the
 * sign allowed bare against the currency mark before it ("-R$150,00"),
 * separated by whitespace ("- R$ 150,00" / "R$ 150,00"), or bare AFTER the
 * currency mark ("R$-7.110,28" — seen in a real PagSeguro fatura summary
 * box, opposite order from the historical PagBank bug). All three are real.
 */
export function findMoneyInText(text: string): FoundMoney | null {
  // The integer-part alternatives must be grouped BEFORE the mandatory
  // ",XX" — written as two top-level alternatives instead, the engine
  // matches the thousands-grouped form and stops there, silently dropping
  // the decimal part (a real bug caught writing this: "1.234,56" parsed
  // as "1.234" alone).
  const match = /(-)?\s*R\$\s*(-)?\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/.exec(text)
  if (!match) return null

  const [, signBefore, signAfter, numberText] = match
  const amountCents = parseBrlAmountToCents(numberText)
  if (amountCents === null) return null

  return { amountCents, negative: signBefore === '-' || signAfter === '-' }
}

/**
 * Same shape as `findMoneyInText`, but with no `R$` marker required — Itaú,
 * C6's fatura, Nubank, and the PagSeguro fatura all measured real (2026-08),
 * with amounts that never carry a currency mark on a transaction line (`R$`
 * appears, if at all, only on unrelated summary/subtotal lines elsewhere in
 * the document). A leading "-" is the only sign form seen; its absence
 * means positive. The mandatory ",XX" suffix is what keeps this from
 * false-matching a CNPJ or account number elsewhere on the same line — a
 * CNPJ ("60.819.321/0001-44") has no comma-decimal to match.
 */
export function findBareMoneyInText(text: string): FoundMoney | null {
  const match = /(-)?\s*((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})/.exec(text)
  if (!match) return null

  const [, sign, numberText] = match
  const amountCents = parseBrlAmountToCents(numberText)
  if (amountCents === null) return null

  return { amountCents, negative: sign === '-' }
}
