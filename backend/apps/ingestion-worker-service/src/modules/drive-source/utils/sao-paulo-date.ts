/**
 * Today's date, `YYYY-MM-DD`, in America/Sao_Paulo — the operator's calendar, whatever
 * the server's clock and zone say. It is where a month still in progress ends, so the
 * expected operating days of the current month are counted up to it.
 */
export function todayInSaoPaulo(now: Date = new Date()): string {
  // The en-CA locale formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
