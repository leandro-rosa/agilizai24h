"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { Payables } from "@/lib/api/purchases";
import { formatCents } from "@/lib/purchases/money";
import { monthLabel } from "./labels";

/** Seis meses: o que foi pago (no dia do pagamento) e o que está aberto, pelo mês em que vence. */
export function EvolutionChart({ series }: { series: Payables["series"] }) {
  const data = series.map((point) => ({
    month: monthLabel(point.month),
    Pago: point.paid_cents / 100,
    "A pagar": point.to_pay_cents / 100,
    Vencido: point.overdue_cents / 100,
    "Pagar na entrega": point.on_delivery_cents / 100,
  }));

  return (
    <div className="h-64 w-full min-w-0" role="img" aria-label="Evolução dos pagamentos nos últimos seis meses">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} strokeOpacity={0.2} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)} mil` : String(v))} width={56} />
          <Tooltip formatter={(value) => formatCents(Math.round(Number(value) * 100))} />
          <Legend />
          <Bar dataKey="Pago" stackId="a" fill="var(--success)" />
          <Bar dataKey="A pagar" stackId="a" fill="var(--primary)" />
          <Bar dataKey="Vencido" stackId="a" fill="var(--destructive)" />
          <Bar dataKey="Pagar na entrega" stackId="a" fill="var(--warning)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
