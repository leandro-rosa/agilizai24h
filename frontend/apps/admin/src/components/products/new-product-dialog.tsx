"use client";

import type { Product } from "@/lib/api/products";
import { NewProductForm } from "./new-product-form";

/** Novo produto, à mão: o formulário integrado à precificação (cadastro, custo, preço sugerido e aprovação explícita). */
export function NewProductDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (product: Product) => void }) {
  return <NewProductForm open={open} onOpenChange={onOpenChange} onCreated={onCreated} />;
}
