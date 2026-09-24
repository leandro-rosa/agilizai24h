// src/app/(app)/commercial-intelligence/calibration/page.tsx
"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ParameterCatalog } from "@/components/parameter-catalog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mixParameterCatalogSections } from "@/lib/commercial-intelligence/restock-mix/mix/parameter-rows";
import { RUNTIME_MIX_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/mix/parameters";
import { restockParameterCatalogSections } from "@/lib/commercial-intelligence/restock-mix/restock/parameter-rows";
import { RUNTIME_RESTOCK_PARAMETERS } from "@/lib/commercial-intelligence/restock-mix/restock/parameters";

function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning" role="status">
      <p className="font-medium">Valores do ambiente ignorados</p>
      <ul className="mt-1 list-disc pl-4 text-xs">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}

export default function CommercialIntelligenceCalibrationPage() {
  const restock = RUNTIME_RESTOCK_PARAMETERS;
  const mix = RUNTIME_MIX_PARAMETERS;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações avançadas / calibração — Inteligência Comercial"
        description="Os parâmetros provisórios dos motores de Abastecimento Inteligente e Mix das Lojas, com a documentação de cada um. Não é a experiência principal: aqui se revisa, não se decide o negócio."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/commercial-intelligence">
              <ArrowLeft aria-hidden />
              Voltar
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
          <CardDescription>Escritos antes de ver meses reais de uso — guardrails, não regras definitivas. Nunca ajustados para fazer aparecer resultado.</CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="restock" className="gap-4">
        <TabsList>
          <TabsTrigger value="restock">Abastecimento Inteligente</TabsTrigger>
          <TabsTrigger value="mix">Mix das Lojas</TabsTrigger>
        </TabsList>

        <TabsContent value="restock" className="flex flex-col gap-4">
          <WarningsBanner warnings={restock.warnings} />
          <ParameterCatalog sections={restockParameterCatalogSections(restock.parameters)} />
        </TabsContent>

        <TabsContent value="mix" className="flex flex-col gap-4">
          <WarningsBanner warnings={mix.warnings} />
          <ParameterCatalog sections={mixParameterCatalogSections(mix.parameters)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
