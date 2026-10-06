"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PaymentMethod, PaymentTerm } from "@/lib/api/purchases";

export interface OrderTerms {
  expectedDelivery: string;
  /** "" = não informado. */
  term: PaymentTerm | "";
  dueOn: string;
  /** Como se paga: "" = não informado. */
  method: PaymentMethod | "";
}

export const EMPTY_TERMS: OrderTerms = { expectedDelivery: "", term: "", dueOn: "", method: "" };

/** Um boleto precisa de data; "paga ao receber" não precisa (vence no dia do recebimento). Devolve o problema ou null. */
export function termsProblem(terms: OrderTerms): string | null {
  if (terms.term === "due_date" && !terms.dueOn) return "Informe o vencimento do boleto.";
  return null;
}

/** Os campos da API a partir dos termos digitados (só o que foi informado). */
export function termsPayload(terms: OrderTerms): { expected_delivery_on?: string; payment_term?: PaymentTerm; payment_due_on?: string; payment_method?: PaymentMethod } {
  return {
    ...(terms.expectedDelivery ? { expected_delivery_on: terms.expectedDelivery } : {}),
    ...(terms.term ? { payment_term: terms.term } : {}),
    ...(terms.term === "due_date" && terms.dueOn ? { payment_due_on: terms.dueOn } : {}),
    ...(terms.method ? { payment_method: terms.method } : {}),
  };
}

const NONE = "none";

/** Prazo de entrega e condição de pagamento (paga ao receber, ou boleto para o dia X). */
export function OrderTermsFields({ value, onChange }: { value: OrderTerms; onChange: (next: OrderTerms) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Prazo de entrega
        <Input type="date" value={value.expectedDelivery} onChange={(e) => onChange({ ...value, expectedDelivery: e.target.value })} aria-label="Prazo de entrega" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Pagamento
        <Select value={value.term === "" ? NONE : value.term} onValueChange={(next) => onChange({ ...value, term: next === NONE ? "" : (next as PaymentTerm) })}>
          <SelectTrigger aria-label="Condição de pagamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Não informado</SelectItem>
            <SelectItem value="on_receipt">Paga ao receber</SelectItem>
            <SelectItem value="due_date">Vence no dia…</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {value.term === "due_date" && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Vencimento
          <Input type="date" value={value.dueOn} onChange={(e) => onChange({ ...value, dueOn: e.target.value })} aria-label="Vencimento do boleto" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Forma
        <Select value={value.method === "" ? NONE : value.method} onValueChange={(next) => onChange({ ...value, method: next === NONE ? "" : (next as PaymentMethod) })}>
          <SelectTrigger aria-label="Forma de pagamento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Não informada</SelectItem>
            <SelectItem value="boleto">Boleto</SelectItem>
            <SelectItem value="transfer">Pix / transferência</SelectItem>
            <SelectItem value="other">Outra</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
