"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ParameterCatalog } from "@/components/parameter-catalog";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RUNTIME_PARAMETERS } from "@/lib/loss-intelligence/parameters";
import { lossParameterCatalogSections } from "@/lib/loss-intelligence/parameter-rows";

export default function LossIntelligenceCalibrationPage() {
  const { parameters, warnings } = RUNTIME_PARAMETERS;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações avançadas / calibração — Agente de Perdas"
        description="Os 20 thresholds provisórios do motor de Loss Intelligence, com a documentação de cada um. Não é a experiência principal: aqui se revisa, não se decide o negócio."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/supply">
              <ArrowLeft aria-hidden />
              Voltar a Perdas
            </Link>
          </Button>
        }
      />

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Todos os valores são provisórios
            <StatusBadge tone="attention">provisório</StatusBadge>
          </CardTitle>
          <CardDescription>Escritos antes de ver meses reais — guardrails, não regras definitivas. Nunca ajustados para fazer aparecer resultado.</CardDescription>
        </CardHeader>
      </Card>

      {warnings.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning" role="status">
          <p className="font-medium">Valores do ambiente ignorados</p>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <ParameterCatalog sections={lossParameterCatalogSections(parameters)} />
    </div>
  );
}
