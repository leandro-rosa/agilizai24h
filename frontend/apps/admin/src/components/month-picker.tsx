"use client";

import { useState } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const MONTH_FULL = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return `${MONTH_FULL[month - 1]} de ${year}`;
}

/**
 * Replaces the browser's native `<input type="month">`, whose picker UI
 * varies wildly by browser/OS and is awkward to operate reliably — every
 * real backend period here is a whole month (`YYYY-MM`), never a day, so a
 * day-grid calendar would be the wrong grain anyway.
 */
export function MonthPicker({ value, onChange }: { value: string; onChange: (period: string) => void }) {
  const [open, setOpen] = useState(false);
  const [year, month] = value.split("-").map(Number);
  const [viewYear, setViewYear] = useState(year);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setViewYear(year);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-48 justify-start gap-2 font-normal">
          <CalendarIcon className="size-4 text-muted-foreground" />
          {formatPeriodLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3">
        <div className="flex items-center justify-between pb-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setViewYear((y) => y - 1)}
            aria-label="Ano anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium">{viewYear}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setViewYear((y) => y + 1)}
            aria-label="Próximo ano"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MONTH_LABELS.map((label, index) => {
            const isSelected = viewYear === year && index + 1 === month;
            return (
              <Button
                key={label}
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                className={cn("h-8", isSelected && "brand-gradient text-white")}
                onClick={() => {
                  onChange(`${viewYear}-${String(index + 1).padStart(2, "0")}`);
                  setOpen(false);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
