import { productsFixture } from "./products";
import { storesFixture } from "./stores";

export interface SupplyRequest {
  id: string;
  storeId: string;
  productId: string;
  requestedQuantity: number;
  status: "pending" | "scheduled" | "completed";
  scheduledDate: string;
}

function seeded(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const statusOptions: SupplyRequest["status"][] = ["pending", "scheduled", "completed"];
const eligibleStores = storesFixture.filter((store) => store.status !== "inactive");
const today = new Date("2026-08-11T00:00:00Z");

export const supplyFixture: SupplyRequest[] = Array.from({ length: 24 }, (_, i) => {
  const store = eligibleStores[i % eligibleStores.length];
  const product = productsFixture[Math.floor(seeded(i * 5.5) * productsFixture.length)];
  const dayOffset = Math.floor(seeded(i * 4.4) * 14) - 5;
  const date = new Date(today);
  date.setDate(date.getDate() + dayOffset);

  return {
    id: `sp-${String(i + 1).padStart(3, "0")}`,
    storeId: store.id,
    productId: product.id,
    requestedQuantity: 10 + Math.floor(seeded(i * 6.1) * 40),
    status: statusOptions[Math.floor(seeded(i * 3.7) * statusOptions.length)],
    scheduledDate: date.toISOString(),
  };
}).sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1));
