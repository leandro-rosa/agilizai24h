const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar day as the report days are written: YYYY-MM-DD, from the local calendar (no UTC shift). */
export function toDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type Shortcut = "last7" | "currentMonth" | "previousMonth";

/** The filter shortcuts. "Últimos 7 dias" = today and the 6 days before it. */
export function shortcutRange(shortcut: Shortcut, today: Date = new Date()): { from: string; to: string } {
  if (shortcut === "last7") {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    return { from: toDay(start), to: toDay(today) };
  }

  const offset = shortcut === "currentMonth" ? 0 : -1;
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const last = shortcut === "currentMonth" ? today : new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: toDay(first), to: toDay(last) };
}
