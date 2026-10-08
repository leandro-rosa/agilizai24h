"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Um campo de valor em reais com o "R$" à vista, grande o bastante para clicar e ler. O texto é livre ("84,00"); quem usa converte com `parseMoneyToCents`. */
export function MoneyField({ label, value, onChange, hint, error, placeholder = "0,00", readOnly = false, className, id }: { label: string; value: string; onChange?: (value: string) => void; hint?: string; error?: string | null; placeholder?: string; readOnly?: boolean; className?: string; id?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm font-medium", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="relative block">
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          R$
        </span>
        <Input id={id} value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} inputMode="decimal" placeholder={placeholder} aria-label={label} aria-invalid={error ? true : undefined} className="tabular h-11 pl-9 text-base" />
      </span>
      {error ? <span className="text-xs font-normal text-destructive">{error}</span> : hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Seção de um painel lateral: título fixo e conteúdo, com o espaçamento dos painéis de produto. */
export function PanelSection({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 border-t pt-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Seção recolhível (informação secundária): fechada por padrão, com o resumo na linha. */
export function Expandable({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium hover:bg-muted/50">
        <span>
          {title}
          {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
        </span>
        <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm">{children}</div>
    </details>
  );
}
