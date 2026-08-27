/**
 * Same fold treasury-service's `normalizeCounterparty` applies (caixa,
 * acento e pontuação não importam) — used here for structural-pattern
 * matching so a pattern literal written with an accent ("Cartão") and PDF
 * text whose accent encoding differs still compare equal. Found by a real
 * test failure: a hardcoded, unaccented "INCLUSAO DE PAGAMENTO" literal
 * never matched extracted text's "INCLUSÃO DE PAGAMENTO".
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
