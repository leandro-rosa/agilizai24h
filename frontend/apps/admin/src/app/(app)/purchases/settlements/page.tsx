"use client";

import { PageHeader } from "@/components/page-header";
import { ClosingScreen } from "@/components/purchases/closing-screen";

export default function SettlementsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Fechamentos de fornecedores"
        description="Confira as vendas e calcule o valor a repassar ao fornecedor."
      />
      <ClosingScreen />
    </div>
  );
}
