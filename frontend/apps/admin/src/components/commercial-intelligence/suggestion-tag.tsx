"use client";

import { Sparkles } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * "✦ Sugestão IA". Only the icon is `text-primary`: small primary text on the
 * dark card measures about 3.4:1 and fails the 4.5:1 rule, while the icon is a
 * graphical object held to 3:1. The label stays in the foreground colour.
 *
 * The honest reading, in the tooltip: it is rule-based statistics over observed
 * data, no model is called, and nothing is ever applied automatically.
 */
export function SuggestionTag({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-foreground", className)} tabIndex={0}>
          <Sparkles className="size-3.5 text-primary" aria-hidden />
          Sugestão IA
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        Regra estatística sobre dado observado. Nenhum modelo de linguagem é chamado e nada é aplicado automaticamente: é uma sugestão para você avaliar.
      </TooltipContent>
    </Tooltip>
  );
}
