import { storesFixture } from "./stores";

export interface FinancialTransaction {
  id: string;
  storeId: string;
  date: string;
  type: "revenue" | "expense";
  category: string;
  value: number;
  description: string;
}

function seeded(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const revenueCategories = ["Vendas", "Reembolso fornecedor"];
const expenseCategories = ["Reposição de estoque", "Manutenção equipamento", "Logística", "Energia", "Taxas de pagamento"];
const activeStores = storesFixture.filter((store) => store.status === "active");
const today = new Date("2026-08-11T00:00:00Z");

export const financeFixture: FinancialTransaction[] = Array.from({ length: 40 }, (_, i) => {
  const store = activeStores[i % activeStores.length];
  const daysAgo = Math.floor(seeded(i * 4.2) * 30);
  const date = new Date(today);
  date.setDate(date.getDate() - daysAgo);

  const type: FinancialTransaction["type"] = seeded(i * 6.6) > 0.4 ? "revenue" : "expense";
  const category = type === "revenue"
    ? revenueCategories[Math.floor(seeded(i * 2.1) * revenueCategories.length)]
    : expenseCategories[Math.floor(seeded(i * 3.3) * expenseCategories.length)];
  const value = type === "revenue"
    ? Math.round((300 + seeded(i * 9.1) * 1200) * 100) / 100
    : Math.round((80 + seeded(i * 8.4) * 600) * 100) / 100;

  return {
    id: `fn-${String(i + 1).padStart(3, "0")}`,
    storeId: store.id,
    date: date.toISOString(),
    type,
    category,
    value,
    description: `${category} — ${store.name}`,
  };
}).sort((a, b) => (a.date < b.date ? 1 : -1));
