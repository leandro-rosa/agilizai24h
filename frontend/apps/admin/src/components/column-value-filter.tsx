"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Filtro por valor exato de uma coluna, tipo AutoFilter de planilha —
 * pedido do operador 2026-09-18 (em /finance/stores primeiro, depois em
 * /finance/cash-flow): "quero filtrar funcionários e ver todas as lojas
 * com 50 funcionários, ou todas as lojas da Ascenty" — marcar mais de um
 * valor na mesma coluna é OR, combinar colunas diferentes é AND (quem
 * monta o AND é o chamador, filtrando pela interseção dos `selected` de
 * cada coluna).
 */
export function ColumnValueFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Map<string, { label: string; count: number }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const entries = [...options.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, "pt-BR", { numeric: true }));

  function toggle(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={selected.size > 0 ? "secondary" : "outline"} size="sm" className="gap-1.5">
          {label}
          {selected.size > 0 && (
            <span className="tabular rounded-full bg-primary/15 px-1.5 text-xs text-primary">{selected.size}</span>
          )}
          <ChevronDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} />
          <CommandList className="max-h-64">
            <CommandEmpty>Nenhum valor neste período.</CommandEmpty>
            <CommandGroup>
              {entries.map(([key, { label: optionLabel, count }]) => (
                <CommandItem key={key} value={optionLabel} onSelect={() => toggle(key)}>
                  <Checkbox checked={selected.has(key)} className="pointer-events-none mr-1.5" />
                  <span className="flex-1 truncate">{optionLabel}</span>
                  <span className="tabular text-xs text-muted-foreground">{count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.size > 0 && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => onChange(new Set())}>
                Limpar {label}
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
