"use client";

import { PageHeader } from "@/components/page-header";
import { SettlementScreen } from "@/components/purchases/settlement-screen";

export default function SettlementsPage() {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Acerto semanal"
        description="Para o consignado: paga-se só o que vendeu. O painel calcula uma proposta com a evidência; ela só vale depois que você confirma, e o “pago” é só o registro."
      />
      <SettlementScreen />
    </div>
  );
}
