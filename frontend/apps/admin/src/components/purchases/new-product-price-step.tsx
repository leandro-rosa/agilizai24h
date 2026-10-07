"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChooseNewProductPriceMutation, useGetNewProductSuggestionQuery, type NewProductChoiceKind } from "@/lib/api/pricing";
import { formatCents, parseMoneyToCents } from "@/lib/purchases/money";

const pct = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")}%`;

/**
 * O preço de um produto que acabou de ser cadastrado pela nota. A sugestão vem do MESMO motor da Precificação Inteligente (o painel só
 * mostra); sem histórico de vendas ela é sempre de confiança baixa e diz quais dados usou. Nenhum preço é aplicado sem a pessoa escolher:
 * usar a sugerida, digitar outro (com motivo) ou salvar sem preço. A escolha fica registrada.
 */
export function NewProductPriceStep({
  sku,
  name,
  costCents,
  costOrigin,
  costNotReceived,
  onDone,
}: {
  sku: string;
  name: string;
  costCents: number;
  costOrigin: string;
  costNotReceived: boolean;
  onDone: () => void;
}) {
  const query = useGetNewProductSuggestionQuery({ sku, costCents, costOrigin, costNotReceived });
  const [choose, { isLoading: saving }] = useChooseNewProductPriceMutation();
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  // Uma chave por clique repetido, não por tela: repetir o mesmo clique é uma escolha só; outra escolha é outra.
  const [mount] = useState(() => `np-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const suggestion = query.data?.suggestion;
  const typedCents = parseMoneyToCents(typed);

  async function save(choice: NewProductChoiceKind, chosenPriceCents?: number) {
    try {
      await choose({
        sku,
        idempotencyKey: `${mount}:${choice}:${chosenPriceCents ?? ""}`,
        choice,
        chosenPriceCents,
        reason: choice === "changed_by_hand" ? reason.trim() : undefined,
        costCents,
        costOrigin,
        costNotReceived,
      }).unwrap();
      toast.success(choice === "left_without_price" ? `${name} ficou sem preço por enquanto.` : `Preço de ${name} definido em ${formatCents(chosenPriceCents as number)}.`);
      onDone();
    } catch (failure) {
      toast.error((failure as { data?: { message?: string } })?.data?.message ?? "Não foi possível registrar a escolha do preço.");
    }
  }

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Calculando o preço sugerido…</p>;
  if (query.isError || !suggestion) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-destructive">Não foi possível calcular o preço sugerido agora.</p>
        <p className="text-xs text-muted-foreground">O produto já está cadastrado. Você pode salvar sem preço e definir depois na Precificação Inteligente.</p>
        <Button variant="outline" onClick={() => save("left_without_price")} disabled={saving}>
          Salvar sem preço
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{suggestion.label}</p>
        {suggestion.suggestedPriceCents !== null ? (
          <>
            <p className="mt-1 text-2xl font-semibold tabular">{formatCents(suggestion.suggestedPriceCents)}</p>
            <p className="text-sm text-muted-foreground">
              Preço sugerido · confiança <strong>baixa</strong> (sem vendas para confirmar)
              {suggestion.suggestedMargin !== null ? ` · margem estimada ${pct(suggestion.suggestedMargin)} (meta ${pct(suggestion.targetMargin)})` : ""}
              {suggestion.minimumPriceCents !== null ? ` · mínimo ${formatCents(suggestion.minimumPriceCents)}` : ""}
            </p>
            <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
              {suggestion.reasons.map((reasonText) => (
                <li key={reasonText}>{reasonText}</li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm font-medium">Sem preço sugerido</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-destructive">
              {suggestion.insufficientReasons.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      {suggestion.dataUsed.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Dados usados na sugestão</summary>
          <table className="mt-2 w-full">
            <tbody>
              {suggestion.dataUsed.map((row) => (
                <tr key={row.code} className="border-b last:border-0">
                  <td className="py-1 pr-2 font-medium">{row.label}</td>
                  <td className="py-1 pr-2 tabular">{row.value}</td>
                  <td className="py-1 text-muted-foreground">{row.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {typing && (
        <div className="grid gap-2 rounded-md border border-dashed p-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Outro preço
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" placeholder="Ex.: 6,90" aria-label="Outro preço" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Motivo (obrigatório quando o preço não é o sugerido)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo do preço digitado" />
          </label>
          <div>
            <Button onClick={() => save("changed_by_hand", typedCents as number)} disabled={saving || typedCents === null || typedCents <= 0 || !reason.trim()}>
              Usar este preço
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {suggestion.suggestedPriceCents !== null && (
          <Button onClick={() => save("suggested_accepted", suggestion.suggestedPriceCents as number)} disabled={saving}>
            Usar preço sugerido
          </Button>
        )}
        <Button variant="outline" onClick={() => setTyping((open) => !open)} disabled={saving}>
          Informar outro preço
        </Button>
        <Button variant="ghost" onClick={() => save("left_without_price")} disabled={saving}>
          Salvar sem preço
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Nenhum preço é aplicado sem a sua escolha. A escolha fica registrada com o seu usuário.</p>
    </div>
  );
}
