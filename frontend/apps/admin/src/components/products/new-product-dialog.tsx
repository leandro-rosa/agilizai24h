"use client";

import type { Product } from "@/lib/api/products";
import { RegisterFromInvoiceDialog } from "@/components/purchases/register-from-invoice-dialog";

/**
 * Novo produto, à mão. É o MESMO formulário e o mesmo serviço do cadastro feito pela nota (`RegisterFromInvoiceDialog`), só sem a evidência da nota:
 * a mesma regra de SKU único e de EAN que não pode ser de dois produtos vale para todas as portas de entrada.
 */
export function NewProductDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (product: Product) => void }) {
  return <RegisterFromInvoiceDialog open={open} onOpenChange={onOpenChange} onCreated={onCreated} />;
}
