"use client";

import { ChevronDown, FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExportModel } from "@/lib/pricing/export-model";

/**
 * Excel e PDF do relatório em tela, já filtrado. Sem relatório carregado os dois ficam desligados e dizem por quê.
 * O renderizador do PDF só é carregado no clique (é pesado), nunca no bundle da página.
 */
export function ExportButtons({ model, unavailableReason }: { model: ExportModel | null; unavailableReason: string }) {
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const disabled = model === null || busy !== null;
  const why = model === null ? unavailableReason : undefined;

  async function excel() {
    if (!model) return;
    setBusy("excel");
    try {
      const { downloadWorkbook } = await import("@/lib/pricing/excel");
      downloadWorkbook(model);
    } catch (error) {
      console.error("Exportar Excel falhou", error);
      toast.error("Não foi possível gerar a planilha.");
    } finally {
      setBusy(null);
    }
  }

  async function pdf() {
    if (!model) return;
    setBusy("pdf");
    try {
      const [{ pdf: render }, { PricingReport }] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/pricing/pdf/report")]);
      const blob = await render(<PricingReport model={model} meta={{ generatedAt: new Date().toISOString(), logoSrc: `${window.location.origin}/brand/lockup-dark.png` }} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Precificacao-Agiliz-${model.period}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Exportar PDF falhou", error);
      toast.error("Não foi possível gerar o PDF.", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled} title={why} aria-describedby={why ? "export-why" : undefined}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <FileDown aria-hidden />}
            Exportar
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void excel()}>
            <FileSpreadsheet aria-hidden /> Excel (planilha)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void pdf()}>
            <FileDown aria-hidden /> PDF (relatório)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {why && (
        <span id="export-why" className="sr-only">
          {why}
        </span>
      )}
    </>
  );
}
