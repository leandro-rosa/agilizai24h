export interface SupplierOption {
  id: number;
  name: string;
  /** Já tem item consignado em alguma compra: o acerto tem o que calcular. */
  consigned: boolean;
}

interface SupplierLike {
  id: number;
  name: string;
  status: string;
}

interface PurchaseLike {
  supplier_id: number;
  supplier_name: string | null;
  items: { condition: string }[];
}

/**
 * Quem pode ser escolhido no acerto: todo fornecedor ativo, não só quem já tem compra consignada — um fornecedor que acabou de
 * virar consignado ainda não tem nenhuma. Quem já tem item consignado vem primeiro (e é marcado); um inativo só aparece se ainda
 * tem consignado a acertar.
 */
export function supplierOptions(suppliers: SupplierLike[], purchases: PurchaseLike[]): SupplierOption[] {
  const consignedNames = new Map<number, string | null>();
  for (const purchase of purchases) if (purchase.items.some((item) => item.condition === "on_sale")) consignedNames.set(purchase.supplier_id, purchase.supplier_name);

  const options = new Map<number, SupplierOption>();
  for (const supplier of suppliers) {
    const consigned = consignedNames.has(supplier.id);
    if (supplier.status === "active" || consigned) options.set(supplier.id, { id: supplier.id, name: supplier.name, consigned });
  }
  for (const [id, name] of consignedNames) if (!options.has(id)) options.set(id, { id, name: name ?? `Fornecedor ${id}`, consigned: true });

  return [...options.values()].sort((a, b) => Number(b.consigned) - Number(a.consigned) || a.name.localeCompare(b.name, "pt-BR"));
}
