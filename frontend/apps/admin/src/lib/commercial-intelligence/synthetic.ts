/**
 * The synthetic-data guard (design D18). Anything named as synthetic — the
 * same marker the Drive ingestion refuses (`sintético`, `synthetic`,
 * `[teste]`) — never takes part in an analysis on the real gateway, whatever
 * else is true of it. Only a run against a mock data source keeps it, and then
 * it stays visibly labelled.
 */
const SYNTHETIC_MARKER = /sintetic|synthetic|\[teste\]/;

/** Lower-cased and stripped of accents, so `[SINTÉTICO]` and `sintetico` are one thing. */
function fold(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function isSynthetic(name: string | null | undefined): boolean {
  return name != null && SYNTHETIC_MARKER.test(fold(name));
}

export interface SyntheticPartition<T> {
  kept: T[];
  excluded: T[];
}

/** Splits `items` by their name. With `allow`, everything is kept (a mock run); nothing is ever silently dropped. */
export function partitionSynthetic<T extends { name: string }>(items: T[], allow: boolean): SyntheticPartition<T> {
  if (allow) return { kept: items, excluded: [] };

  const kept: T[] = [];
  const excluded: T[] = [];
  for (const item of items) (isSynthetic(item.name) ? excluded : kept).push(item);
  return { kept, excluded };
}
