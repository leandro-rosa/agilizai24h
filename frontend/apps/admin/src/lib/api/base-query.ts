import type { BaseQueryFn } from "@reduxjs/toolkit/query";

import { financeFixture } from "@/mocks/finance";
import { inventoryFixture } from "@/mocks/inventory";
import { productsFixture } from "@/mocks/products";
import { salesFixture } from "@/mocks/sales";
import { storesFixture } from "@/mocks/stores";
import { supplyFixture } from "@/mocks/supply";

const collections = {
  stores: storesFixture,
  products: productsFixture,
  inventory: inventoryFixture,
  sales: salesFixture,
  finance: financeFixture,
  supply: supplyFixture,
} as const;

export type MockCollection = keyof typeof collections;

interface MockRequest {
  collection: MockCollection;
}

const delay = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mocked baseQuery: simulates a network call reading from in-memory
 * fixtures. Seam to swap for `fetchBaseQuery` once the real API exists
 * (see gaps in ../../../CLAUDE.md).
 */
export const mockBaseQuery: BaseQueryFn<MockRequest, unknown, { message: string }> = async ({
  collection,
}) => {
  await delay();
  const data = collections[collection];
  if (!data) {
    return { error: { message: `Unknown mock collection: ${collection}` } };
  }
  return { data };
};
