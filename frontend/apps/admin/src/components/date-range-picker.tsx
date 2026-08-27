"use client";

import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface DayRange {
  from?: string;
  to?: string;
}

function parseLocal(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/**
 * Range de dias reais (`occurred_on`), diferente de `PeriodRange` (mês
 * inteiro, `month-range-picker.tsx`) — treasury é o único domínio do
 * painel com granularidade diária por lançamento.
 */
export function DateRangePicker({ value, onChange }: { value: DayRange; onChange: (range: DayRange) => void }) {
  const selected: DateRange | undefined = value.from
    ? { from: parseLocal(value.from), to: value.to ? parseLocal(value.to) : undefined }
    : undefined;

  function handleSelect(range: DateRange | undefined) {
    onChange({
      from: range?.from ? format(range.from, "yyyy-MM-dd") : undefined,
      to: range?.to ? format(range.to, "yyyy-MM-dd") : undefined,
    });
  }

  const label = value.from
    ? value.to && value.to !== value.from
      ? `${format(parseLocal(value.from), "dd/MM/yyyy")} – ${format(parseLocal(value.to), "dd/MM/yyyy")}`
      : format(parseLocal(value.from), "dd/MM/yyyy")
    : "Todos os dias do período";

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("w-64 justify-start text-left font-normal", !value.from && "text-muted-foreground")}
          >
            <CalendarIcon />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="range" selected={selected} onSelect={handleSelect} numberOfMonths={2} />
        </PopoverContent>
      </Popover>
      {value.from && (
        <Button variant="ghost" size="icon" onClick={() => onChange({})} aria-label="Limpar intervalo de dias">
          <X />
        </Button>
      )}
    </div>
  );
}
