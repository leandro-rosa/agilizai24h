"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ParameterCatalog } from "@/components/commercial-intelligence/parameter-catalog";
import { RUNTIME_PARAMETERS } from "@/components/commercial-intelligence/runtime-parameters";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LOGIC_VERSION } from "@/lib/commercial-intelligence/logic-version";
import { DEFAULT_PARAMETERS, PARAMETER_PATHS } from "@/lib/commercial-intelligence/parameters";

const REPORT_ITEMS = [
  "a distribuição da cobertura de cupom por loja e por mês, dos tamanhos de amostra e da resolução de custos",
  "quantas lojas seriam excluídas pelos critérios provisórios",
  "quantos produtos ficariam sem dados suficientes",
  "quantos pares de produtos passariam pelos filtros",
  "quantas oportunidades seriam geradas e quantas recomendações seriam bloqueadas",
];

export default function CalibrationPage() {
  const { parameters, warnings } = RUNTIME_PARAMETERS;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configurações avançadas / calibração"
        description="Os critérios de qualidade dos dados e o modelo analítico da Inteligência Comercial, com a documentação de cada parâmetro. Não é a experiência principal: aqui se revisa, não se decide o negócio."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/commercial-intelligence">
              <ArrowLeft aria-hidden />
              Voltar à Inteligência Comercial
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
          <CardDescription>
            São guardrails iniciais, escritos antes de ver dados reais — não regras definitivas. Serão revisados com a distribuição real dos dados da Agiliz.ai. O objetivo da calibração é evitar
            falso sinal sem bloquear análises úteis; <strong>nunca ajustar um limiar para fazer aparecer resultado.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>
            {PARAMETER_PATHS.length} parâmetros · versão da lógica <code className="text-xs">{LOGIC_VERSION}</code>. Cada recomendação registra a versão e os valores em vigor quando foi
            gerada, então mudar um valor aqui nunca reescreve o que uma recomendação anterior usou.
          </p>
          <p>Estes valores vêm da implantação (lidos na compilação) e não são editáveis no navegador: o que altera o resultado oficial precisa de registro único, com permissão e histórico.</p>
        </CardContent>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Relatório de calibração
            <StatusBadge>Em espera</StatusBadge>
          </CardTitle>
          <CardDescription>
            Antes de liberar a Inteligência Comercial para produção, este relatório vai mostrar, sobre os meses reais importados, como os parâmetros provisórios se comportariam. Ele precisa dos meses
            reais do Drive e da conferência do cupom e do histórico.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium">Vai mostrar:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {REPORT_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <ParameterCatalog parameters={parameters} defaults={DEFAULT_PARAMETERS} />
    </div>
  );
}
