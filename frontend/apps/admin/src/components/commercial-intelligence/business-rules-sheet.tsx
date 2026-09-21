"use client";

import Link from "next/link";
import { Landmark } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PARAMETER_EXTRA, PARAMETER_KINDS } from "@/lib/commercial-intelligence/parameter-docs";
import { formatParameterValue, getParameter, PARAMETER_DOCS, type CommercialParameters } from "@/lib/commercial-intelligence/parameters";

/**
 * The few decisions that belong to the company, shown read-only. They have one
 * value for the whole operation, so they are never a setting of this browser:
 * two people opening the page must get the same recommendations. Editing them,
 * with permission and a change history, is the official register that
 * `add-commercial-intelligence-governance` delivers; this sheet says so instead
 * of pretending otherwise.
 */
export function BusinessRulesSheet({ parameters }: { parameters: CommercialParameters }) {
  const rules = [...PARAMETER_KINDS.business].sort((a, b) => PARAMETER_DOCS[a].label.localeCompare(PARAMETER_DOCS[b].label, "pt-BR"));

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Landmark aria-hidden />
          Regras de negócio
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Regras de negócio</SheetTitle>
          <SheetDescription>Decisões da empresa que mudam o que a inteligência recomenda. Valem para toda a operação: não são ajustes deste navegador.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <p className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning" role="note">
            O registro oficial destas regras — valor único, com permissão para editar e histórico de alterações — ainda não existe. Por ora vale o padrão da implantação, que não pode ser
            alterado pelo navegador para que ninguém receba recomendações diferentes de outra pessoa.
          </p>

          <ul className="flex flex-col">
            {rules.map((path) => {
              const doc = PARAMETER_DOCS[path];
              const extra = PARAMETER_EXTRA[path];
              return (
                <li key={path} className="flex flex-col gap-0.5 border-t py-3 first:border-t-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-sm font-medium">{doc.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular text-sm font-semibold">{formatParameterValue(path, getParameter(parameters, path))}</span>
                      <StatusBadge tone="attention">padrão provisório</StatusBadge>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{doc.controls}</p>
                  <p className="text-xs text-muted-foreground">Fonte: padrão da implantação · {extra.usedIn}</p>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-muted-foreground">
            Os critérios de qualidade dos dados e o modelo analítico — mínimos de amostra, lift, percentis, confiança — não são decisões de negócio: ficam em{" "}
            <Link href="/commercial-intelligence/calibration" className="underline underline-offset-2">
              Configurações avançadas / calibração
            </Link>
            , todos provisórios até a calibração com os meses reais.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
