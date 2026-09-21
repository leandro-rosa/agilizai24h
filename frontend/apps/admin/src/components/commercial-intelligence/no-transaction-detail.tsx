"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/lib/auth/use-permission";

/**
 * A period with no completed line at all. It is not "zero sales": the detail per
 * transaction (coupon, time, discount) exists only for months imported from the
 * network-wide sales report, and the per-SKU months of the older format that
 * `/sales` shows carry none of it. So the page says why there is nothing and how
 * to get something, instead of guessing that the month is "too old".
 */
export function NoTransactionDetail({ periodInProgress }: { periodInProgress: boolean }) {
  const canSeeIngestion = useHasPermission("ingestion:read");

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="font-medium">Sem detalhe de transação neste período</p>
      {periodInProgress ? (
        <p className="max-w-2xl text-sm text-muted-foreground">Este mês ainda está em andamento e não tem detalhe de transação importado. Escolha um mês fechado.</p>
      ) : (
        <div className="flex max-w-2xl flex-col gap-2 text-sm text-muted-foreground">
          <p>
            O detalhe por transação (cupom, hora, desconto) só existe para os meses importados do <strong className="text-foreground">relatório de vendas por rede</strong>. Os meses do
            formato antigo, por produto, aparecem em Vendas, mas não têm o que esta página precisa para analisar.
          </p>
          <p>
            Se nenhum mês mostra dados, esse relatório ainda não foi importado. Em <strong className="text-foreground">Ingestão</strong>, envie o tipo Vendas com a loja em branco e o mês
            do relatório — ou deixe a leitura pelo Drive fazer isso quando ela estiver configurada. Nada aqui é importado sozinho.
          </p>
        </div>
      )}
      {canSeeIngestion && !periodInProgress && (
        <Button asChild variant="outline" size="sm">
          <Link href="/ingestion">Ir para Ingestão</Link>
        </Button>
      )}
    </div>
  );
}
