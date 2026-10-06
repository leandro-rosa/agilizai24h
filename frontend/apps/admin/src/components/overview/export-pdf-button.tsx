"use client";

import { FileDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useRegisterMonthlySummaryMutation } from "@/lib/api/accounting";
import { BEHAVIOR, DISTRIBUTION } from "@/lib/overview/product-behavior";
import { MATERIALITY } from "@/lib/overview/materiality";
import { sha256Hex, stableStringify } from "@/lib/overview/content-hash";
import type { Overview } from "@/lib/overview/types";

/** Versão da lógica do motor — sobe quando uma regra muda, para o hash e os parâmetros registrados refletirem isso. */
const LOGIC_VERSION = "overview/1.0.0";

export function ExportPdfButton({ overview }: { overview: Overview | null }) {
  const [busy, setBusy] = useState(false);
  const [register] = useRegisterMonthlySummaryMutation();

  async function onClick() {
    if (!overview) return;
    setBusy(true);
    try {
      const hash = await sha256Hex(stableStringify(overview));
      const params = {
        logic_version: LOGIC_VERSION,
        comparisons: ["previous_month", "avg_3_prior_months"],
        materiality: MATERIALITY,
        behavior: BEHAVIOR,
        distribution: DISTRIBUTION,
        sections_unavailable: overview.limitations,
      };
      const reg = await register({ period: overview.period, content_hash: hash, params }).unwrap();

      // Carrega o renderizador só no clique (é pesado), nunca no bundle da página.
      const [{ pdf }, { MonthlyReport }] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/overview/pdf/report")]);
      const blob = await pdf(<MonthlyReport o={overview} meta={{ version: reg.version, generatedAt: reg.generated_at, baseAt: reg.base_at }} />).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Resumo-Mensal-Agiliz-${overview.period}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Resumo ${overview.period} — versão ${reg.version}${reg.reused ? " (mesma base e conteúdo da versão já gerada)" : " gerada"}`);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      toast.error(status === 409 ? "O mês não está fechado na rede — feche o mês antes de exportar." : "Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={onClick} disabled={!overview || busy} variant="outline">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Exportar PDF
    </Button>
  );
}
