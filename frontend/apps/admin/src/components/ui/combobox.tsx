"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Select-like picker over a real list (e.g. `GET /treasury/categories`),
 * but still lets the operator type a value the list doesn't have yet —
 * category/entry_type are free text on purpose (the operation invents a
 * new one most weeks), so a rigid `<Select>` would block that.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Selecione ou digite...",
  emptyLabel = "Nenhuma opção encontrada.",
  className,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // cmdk keys its internal item registry by the lowercased `value` — two
  // options differing only by case (real data: "CDB" vs "cdb") collide
  // there and one silently disappears from the rendered list, even though
  // both are still in `options`. Dedupe here, first occurrence wins, so
  // the combobox never depends on the source data's casing being clean.
  const dedupedOptions = React.useMemo(() => {
    const seen = new Set<string>();
    return options.filter((option) => {
      const key = option.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [options]);

  const exactMatch = dedupedOptions.some((option) => option.toLowerCase() === search.trim().toLowerCase());

  function select(next: string) {
    onChange(next);
    setSearch("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) max-h-(--radix-popover-content-available-height) p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar..." value={search} onValueChange={setSearch} />
          {/* Fixed `max-h-72` would clip below whatever the popover's real available
              space is (real bug: "deslocamento", item 12 of 32, was unreachable —
              no scroll got you to it because the popover itself was already capped
              shorter than 72). Cap by the actual space Radix already computed instead. */}
          <CommandList className="max-h-[min(20rem,var(--radix-popover-content-available-height))]">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {dedupedOptions.map((option) => (
                <CommandItem key={option} value={option} onSelect={select}>
                  <Check className={cn("mr-2 size-4", value === option ? "opacity-100" : "opacity-0")} />
                  {option}
                </CommandItem>
              ))}
              {search.trim() !== "" && !exactMatch && (
                <CommandItem value={search} onSelect={() => select(search.trim())}>
                  Usar &quot;{search.trim()}&quot;
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
