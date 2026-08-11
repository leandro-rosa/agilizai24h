import { productsFixture } from "./products";
import { storesFixture } from "./stores";

export interface SaleItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface Sale {
  id: string;
  storeId: string;
  date: string;
  totalValue: number;
  paymentMethod: "pix" | "card" | "app";
  items: SaleItem[];
}

function seeded(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const paymentMethods: Sale["paymentMethod"][] = ["pix", "card", "app"];
const activeStores = storesFixture.filter((store) => store.status === "active");
const today = new Date("2026-08-11T00:00:00Z");

export const salesFixture: Sale[] = Array.from({ length: 60 }, (_, i) => {
  const store = activeStores[i % activeStores.length];
  const daysAgo = Math.floor(seeded(i * 3.1) * 30);
  const date = new Date(today);
  date.setDate(date.getDate() - daysAgo);

  const itemCount = 1 + Math.floor(seeded(i * 5.7) * 3);
  const items: SaleItem[] = Array.from({ length: itemCount }, (_, j) => {
    const product = productsFixture[Math.floor(seeded(i * 11 + j * 4) * productsFixture.length)];
    return {
      productId: product.id,
      quantity: 1 + Math.floor(seeded(i * 13 + j) * 2),
      unitPrice: product.price,
    };
  });

  const totalValue = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return {
    id: `sl-${String(i + 1).padStart(3, "0")}`,
    storeId: store.id,
    date: date.toISOString(),
    totalValue: Math.round(totalValue * 100) / 100,
    paymentMethod: paymentMethods[Math.floor(seeded(i * 7.3) * paymentMethods.length)],
    items,
  };
}).sort((a, b) => (a.date < b.date ? 1 : -1));
