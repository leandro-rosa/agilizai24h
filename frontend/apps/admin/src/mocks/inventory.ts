import { productsFixture } from "./products";
import { storesFixture } from "./stores";

export interface InventoryItem {
  id: string;
  productId: string;
  storeId: string;
  quantity: number;
  minimum: number;
}

function seeded(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export const inventoryFixture: InventoryItem[] = storesFixture
  .filter((store) => store.status !== "inactive")
  .flatMap((store, storeIdx) =>
    productsFixture
      .filter((_, productIdx) => seeded(storeIdx * 31 + productIdx) > 0.35)
      .map((product, productIdx) => {
        const minimum = product.category === "beverage" || product.category === "essential" ? 15 : 8;
        const quantity = Math.round(seeded(storeIdx * 17 + productIdx * 7) * 40);
        return {
          id: `iv-${store.id}-${product.id}`,
          productId: product.id,
          storeId: store.id,
          quantity,
          minimum,
        };
      }),
  );
