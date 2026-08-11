export interface Product {
  id: string;
  sku: string;
  name: string;
  category: "meal" | "snack" | "beverage" | "essential";
  price: number;
}

export const productsFixture: Product[] = [
  { id: "pd-01", sku: "MEA-001", name: "Marmita Frango Grelhado", category: "meal", price: 24.9 },
  { id: "pd-02", sku: "MEA-002", name: "Marmita Fit Low Carb", category: "meal", price: 26.5 },
  { id: "pd-03", sku: "MEA-003", name: "Marmita Vegetariana", category: "meal", price: 23.9 },
  { id: "pd-04", sku: "MEA-004", name: "Marmita Carne com Legumes", category: "meal", price: 27.9 },
  { id: "pd-05", sku: "SNK-001", name: "Sanduíche Natural de Frango", category: "snack", price: 14.5 },
  { id: "pd-06", sku: "SNK-002", name: "Wrap de Atum", category: "snack", price: 15.9 },
  { id: "pd-07", sku: "SNK-003", name: "Salada Caesar Individual", category: "snack", price: 18.9 },
  { id: "pd-08", sku: "SNK-004", name: "Barra de Cereal Proteica", category: "snack", price: 7.5 },
  { id: "pd-09", sku: "BEV-001", name: "Água Mineral 500ml", category: "beverage", price: 4.0 },
  { id: "pd-10", sku: "BEV-002", name: "Suco Natural Laranja 300ml", category: "beverage", price: 9.5 },
  { id: "pd-11", sku: "BEV-003", name: "Refrigerante Lata 350ml", category: "beverage", price: 6.5 },
  { id: "pd-12", sku: "BEV-004", name: "Café Gelado 250ml", category: "beverage", price: 8.9 },
  { id: "pd-13", sku: "BEV-005", name: "Água de Coco 300ml", category: "beverage", price: 7.9 },
  { id: "pd-14", sku: "ESS-001", name: "Kit Higiene Bucal", category: "essential", price: 12.9 },
  { id: "pd-15", sku: "ESS-002", name: "Analgésico (blister)", category: "essential", price: 5.9 },
  { id: "pd-16", sku: "ESS-003", name: "Carregador USB-C", category: "essential", price: 34.9 },
  { id: "pd-17", sku: "ESS-004", name: "Guarda-chuva de Bolso", category: "essential", price: 29.9 },
  { id: "pd-18", sku: "SNK-005", name: "Mix de Castanhas 50g", category: "snack", price: 11.5 },
];
