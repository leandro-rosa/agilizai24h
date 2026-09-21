import type { SalesTransaction } from "../api/sales";
import { isOk } from "../sales-insights";
import type { CommercialParameters } from "./parameters";
import type { CouponBasket, Dataset, DatasetLine, PriceState, SkuAggregate, StoreAggregate, WallClock } from "./types";

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The store's local clock at the moment of a sale.
 *
 * `occurred_at` is the wall-clock time the store's terminal recorded, stored as
 * if it were UTC (the ingestion writes `Date.UTC(1899, 11, 30) + serial`). So
 * the UTC accessors return the store's own hour, weekday and date, whatever
 * time zone the viewer's browser is in. Reading it with `getHours()` or
 * `getDay()` shifts it by the viewer's offset — three hours in Brazil — and
 * moves 00:00–02:59 sales to the previous weekday.
 */
export function wallClock(occurredAt: string | null | undefined): WallClock | null {
  if (!occurredAt) return null;

  // A timestamp with no zone would be read as the viewer's local time: pin it to UTC like the rest.
  const ms = Date.parse(HAS_ZONE.test(occurredAt) ? occurredAt : `${occurredAt}Z`);
  if (Number.isNaN(ms)) return null;

  const at = new Date(ms);
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return { date: `${at.getUTCFullYear()}-${month}-${day}`, day: at.getUTCDate(), hour: at.getUTCHours(), weekday: at.getUTCDay(), ms };
}

/**
 * Whether a line was sold at a discount. `discounted` wins over `full` when the
 * two signals disagree, and a line that says nothing either way is `unknown`
 * rather than assumed to be at full price.
 */
export function priceStateOf(paidCents: number, originalCents: number | null, discountCents: number | null): PriceState {
  if ((discountCents !== null && discountCents > 0) || (originalCents !== null && originalCents > paidCents)) return "discounted";
  if (discountCents === 0 || (originalCents !== null && originalCents === paidCents)) return "full";
  return "unknown";
}

function toLine(t: SalesTransaction): DatasetLine {
  const coupon = t.coupon?.trim() ? t.coupon.trim() : null;
  return {
    storeId: t.store_id,
    sku: t.sku,
    quantity: t.quantity,
    paidCents: t.amount_paid_cents,
    originalCents: t.original_amount_cents,
    discountCents: t.discount_cents,
    coupon,
    wall: wallClock(t.occurred_at),
    priceState: priceStateOf(t.amount_paid_cents, t.original_amount_cents, t.discount_cents),
    posId: t.pos_id,
    machineModel: t.machine_model,
  };
}

function emptyStore(storeId: number): StoreAggregate {
  return {
    storeId,
    okLines: 0,
    couponLines: 0,
    revenueCents: 0,
    couponRevenueCents: 0,
    orphanLines: 0,
    couponBaskets: 0,
    multiItemBaskets: 0,
    reusedBaskets: 0,
    reusedLines: 0,
    oversizedBaskets: 0,
    sellingDays: new Set(),
    undatedLines: 0,
  };
}

/**
 * Reduces the network's transactions to what the analyses read, in one pass.
 *
 * Only completed lines (`result` = OK, the same definition `/sales` uses) are
 * kept. A line with a coupon joins the basket `${store}:${coupon}`; a line
 * without one is an orphan, counted and never turned into a one-item basket,
 * because a fake one-item basket inflates every product's basket count and
 * depresses every association. A coupon whose lines span more minutes than the
 * parameters allow is a reused coupon: its basket is dropped and counted.
 *
 * Nothing here decides anything. Coverage, gates and recommendations read this
 * and are computed elsewhere.
 */
export function buildDataset(input: { storeId: number; transactions: SalesTransaction[] }[], p: CommercialParameters): Dataset {
  const lines: DatasetLine[] = [];
  const stores = new Map<number, StoreAggregate>();
  const skus = new Map<number, Map<string, SkuAggregate>>();
  const byCoupon = new Map<string, DatasetLine[]>();

  for (const { storeId, transactions } of input) {
    const aggregate = stores.get(storeId) ?? emptyStore(storeId);
    stores.set(storeId, aggregate);
    const storeSkus = skus.get(storeId) ?? new Map<string, SkuAggregate>();
    skus.set(storeId, storeSkus);

    for (const t of transactions) {
      if (!isOk(t)) continue;

      const line = toLine(t);
      lines.push(line);

      aggregate.okLines += 1;
      aggregate.revenueCents += line.paidCents;
      if (line.wall) aggregate.sellingDays.add(line.wall.date);
      else aggregate.undatedLines += 1;

      const sku = storeSkus.get(line.sku) ?? { sku: line.sku, units: 0, revenueCents: 0, lines: 0, sellingDays: new Set<string>() };
      storeSkus.set(line.sku, sku);
      sku.units += line.quantity;
      sku.revenueCents += line.paidCents;
      sku.lines += 1;
      if (line.wall) sku.sellingDays.add(line.wall.date);

      if (line.coupon === null) {
        aggregate.orphanLines += 1;
        continue;
      }

      aggregate.couponLines += 1;
      aggregate.couponRevenueCents += line.paidCents;
      const key = `${storeId}:${line.coupon}`;
      const group = byCoupon.get(key);
      if (group) group.push(line);
      else byCoupon.set(key, [line]);
    }
  }

  const baskets: CouponBasket[] = [];
  for (const [key, group] of byCoupon) {
    const storeId = group[0].storeId;
    const aggregate = stores.get(storeId) as StoreAggregate;

    const times = group.flatMap((line) => (line.wall ? [line.wall.ms] : []));
    const spanMinutes = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 60_000 : 0;

    if (spanMinutes > p.coupon.spanMaxMinutes) {
      aggregate.reusedBaskets += 1;
      aggregate.reusedLines += group.length;
      continue;
    }

    const distinct = [...new Set(group.map((line) => line.sku))];
    const oversized = distinct.length > p.coupon.maxSkusForPairs;
    aggregate.couponBaskets += 1;
    if (distinct.length >= 2) aggregate.multiItemBaskets += 1;
    if (oversized) aggregate.oversizedBaskets += 1;

    baskets.push({
      key,
      storeId,
      lines: group,
      skus: distinct,
      totalCents: group.reduce((sum, line) => sum + line.paidCents, 0),
      spanMinutes,
      oversized,
    });
  }

  return { lines, baskets, stores, skus };
}
