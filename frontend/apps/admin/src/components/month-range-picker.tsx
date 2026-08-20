"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { presetRange, type PeriodRange } from "@/lib/period-range";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTH_FULL = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

function formatShort(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return `${MONTH_FULL[month - 1]}/${year}`;
}

function MonthGrid({
  label,
  value,
  onChange,
  bound,
  boundIsMin,
}: {
  label: string;
  value: string;
  onChange: (period: string) => void;
  /** The other end of the range — a start cannot move past the end, and vice versa. */
  bound: string;
  boundIsMin: boolean;
}) {
  const [year, month] = value.split("-").map(Number);
  const [viewYear, setViewYear] = useState(year);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" onClick={() => setViewYear((y) => y - 1)} aria-label="Ano anterior">
            <span aria-hidden>‹</span>
          </Button>
          <span className="w-10 text-center text-xs">{viewYear}</span>
          <Button variant="ghost" size="icon-xs" onClick={() => setViewYear((y) => y + 1)} aria-label="Próximo ano">
            <span aria-hidden>›</span>
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_LABELS.map((monthLabel, index) => {
          const candidate = `${viewYear}-${String(index + 1).padStart(2, "0")}`;
          const isSelected = viewYear === year && index + 1 === month;
          const disabled = boundIsMin ? candidate < bound : candidate > bound;
          return (
            <Button
              key={monthLabel}
              variant={isSelected ? "default" : "ghost"}
              size="sm"
              disabled={disabled}
              className={cn("h-7 text-xs", isSelected && "bg-primary text-primary-foreground hover:bg-primary/90")}
              onClick={() => onChange(candidate)}
            >
              {monthLabel}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Every real backend period is a whole month — this picks a *range* of
 * them, since that is the finest grain honestly available (no daily or
 * weekly data exists anywhere in the pipeline). Quarter/semester/year are
 * presets over that same monthly grain, not a different resolution.
 */
export function MonthRangePicker({ value, onChange }: { value: PeriodRange; onChange: (range: PeriodRange) => void }) {
  const [open, setOpen] = useState(false);
  const label = value.start === value.end ? formatShort(value.start) : `${formatShort(value.start)} – ${formatShort(value.end)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-56 justify-start gap-2 font-normal">
          <CalendarIcon className="size-4 text-muted-foreground" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <div className="flex flex-wrap gap-1.5 pb-3">
          {(
            [
              ["month", "Mês"],
              ["quarter", "Trimestre"],
              ["semester", "Semestre"],
              ["year", "Ano"],
            ] as const
          ).map(([preset, presetLabel]) => (
            <Button
              key={preset}
              variant="secondary"
              size="sm"
              onClick={() => {
                onChange(presetRange(preset, value.end));
                setOpen(false);
              }}
            >
              {presetLabel}
            </Button>
          ))}
        </div>
        <Separator />
        <div className="flex gap-4 pt-3">
          <MonthGrid
            label="Início"
            value={value.start}
            bound={value.end}
            boundIsMin={false}
            onChange={(start) => onChange({ start, end: value.end })}
          />
          <MonthGrid
            label="Fim"
            value={value.end}
            bound={value.start}
            boundIsMin={true}
            onChange={(end) => onChange({ start: value.start, end })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
