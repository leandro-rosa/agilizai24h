"use client";

import Link from "next/link";
import { Landmark } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { ParameterRuleRow } from "@/components/parameter-catalog";

export interface BusinessRuleRow {
  path: string;
  label: string;
  formattedValue: string;
  controls: string;
  usedIn: string;
}

export function businessRuleRowFrom(row: ParameterRuleRow): BusinessRuleRow {
  return { path: row.path, label: row.label, formattedValue: row.formattedValue, controls: row.controls, usedIn: row.usedIn };
}

/**
 * The few decisions that belong to the company, shown read-only. They have one
 * value for the whole operation, so they are never a setting of this browser.
 * Domain-agnostic: the caller resolves its own parameter type into rows and
 * says where its own calibration page lives.
 */
export function BusinessRulesSheet({
  description,
  rows,
  calibrationHref,
}: {
  description: string;
  rows: BusinessRuleRow[];
  calibrationHref: string;
}) {
  const sorted = [...rows].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

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
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <p className="rounded-lg border border-warning/30 bg-warning/12 p-3 text-sm text-warning" role="note">
            O registro oficial destas regras — valor único, com permissão para editar e histórico de alterações — ainda não existe. Por ora vale o padrão da implantação, que não pode ser
            alterado pelo navegador para que ninguém receba recomendações diferentes de outra pessoa.
          </p>

          <ul className="flex flex-col">
            {sorted.map((row) => (
              <li key={row.path} className="flex flex-col gap-0.5 border-t py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular text-sm font-semibold">{row.formattedValue}</span>
                    <StatusBadge tone="attention">padrão provisório</StatusBadge>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{row.controls}</p>
                <p className="text-xs text-muted-foreground">Fonte: padrão da implantação · {row.usedIn}</p>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            Os critérios de qualidade dos dados e o modelo analítico não são decisões de negócio: ficam em{" "}
            <Link href={calibrationHref} className="underline underline-offset-2">
              Configurações avançadas / calibração
            </Link>
            , todos provisórios até a calibração com os meses reais.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
