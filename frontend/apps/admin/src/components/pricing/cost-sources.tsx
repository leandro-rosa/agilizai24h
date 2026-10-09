import { StatusBadge } from "@/components/status-badge";
import type { CostStructure, VoucherDetail } from "@/lib/api/pricing";
import { count } from "@/lib/format";
import { lossSourceText, percent } from "@/lib/pricing/labels";

const pct2 = (fraction: number) => `${(fraction * 100).toFixed(2).replace(".", ",")}%`;
const bpsText = (bps: number) => pct2(bps / 10_000);

const VOUCHER_METHOD: Record<VoucherDetail["basis"], string> = {
  sales_weighted: "Média ponderada pelas vendas de cada bandeira",
  simple_average: "Média simples das bandeiras cadastradas",
  none: "Nenhuma taxa de VR/VA cadastrada",
};

export interface CostSourceNames {
  product?: string | null;
  category?: string | null;
  store?: string | null;
}

/**
 * De onde vêm a perda e as taxas de pagamento de UM preço, em palavras: a taxa de perda com a FONTE (produto, categoria, loja ou rede) e as unidades por
 * trás dela; o mix de pagamento (do produto, da categoria ou da rede) e, quando há VR/VA, a participação, a taxa efetiva, o método, as bandeiras e o volume.
 * `newProduct`: o produto ainda não tem histórico próprio, então uma perda de categoria vem com a frase que diz isso.
 */
export function CostSources({ structure, names, newProduct = false }: { structure: CostStructure; names: CostSourceNames; newProduct?: boolean }) {
  const loss = structure.lossBasis;
  const fromBroader = structure.lossLevel !== "product";
  const voucher = structure.paymentVoucher;

  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="cost-sources">
      <div data-testid="loss-source">
        <p>
          Perda utilizada: <strong className="tabular">{percent(structure.lossRate)}</strong>
        </p>
        <p className="text-muted-foreground">Fonte: {lossSourceText(structure.lossLevel, names)}</p>
        {loss && (
          <p className="text-xs text-muted-foreground">
            {[
              `${count(Math.round(loss.lostUnits))} un. removidas como perda ÷ ${count(Math.round(loss.suppliedUnits))} un. abastecidas`,
              loss.soldUnits !== null ? `vendidas na janela: ${count(Math.round(loss.soldUnits))} un` : null,
              loss.unaccountedUnits !== null ? `abastecido sem venda nem perda: ${count(Math.round(loss.unaccountedUnits))} un` : null,
            ]
              .filter(Boolean)
              .join("; ")}
            .
          </p>
        )}
        {fromBroader && newProduct && <p className="font-medium text-warning">Produto sem histórico. Utilizada perda da {structure.lossLevel === "category" ? "categoria" : structure.lossLevel === "store" ? "loja" : "rede"}.</p>}
        {fromBroader && !newProduct && structure.lossLevel === "category" && <p className="text-xs text-muted-foreground">O histórico próprio do produto é insuficiente: utilizada a perda da categoria.</p>}
      </div>

      <div data-testid="payment-source">
        <p>
          Taxa de pagamento: <strong className="tabular">{pct2(structure.paymentRate)}</strong>
          {structure.paymentFixedCents > 0 ? ` + R$ ${(structure.paymentFixedCents / 100).toFixed(2).replace(".", ",")} por unidade (taxa fixa)` : ""}
        </p>
        {structure.paymentLevel && (
          <p className="text-muted-foreground">
            Mix de pagamento {structure.paymentLevel === "product" ? "do próprio produto" : structure.paymentLevel === "category" ? "da categoria" : "da rede"}
            {structure.paymentMixLines !== undefined ? ` — ${count(structure.paymentMixLines)} linhas de venda` : ""}
          </p>
        )}
      </div>

      {voucher && (structure.voucherShare > 0 || voucher.basis !== "none") && (
        <div data-testid="voucher-detail" className="rounded-md border p-3">
          <p className="mb-1 flex flex-wrap items-center gap-2 font-medium">
            VR/VA
            <StatusBadge tone={voucher.basis === "sales_weighted" ? "positive" : "attention"}>{VOUCHER_METHOD[voucher.basis]}</StatusBadge>
          </p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Participação no mix</dt>
              <dd className="tabular">{percent(structure.voucherShare)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Taxa efetiva utilizada</dt>
              <dd className="tabular">{voucher.rateBps === null ? "sem taxa cadastrada" : bpsText(voucher.rateBps)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Volume usado no cálculo</dt>
              <dd className="tabular">
                {count(voucher.receiptLines)} linhas de venda com VR/VA (mínimo {count(voucher.minReceiptLines)} para ponderar)
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Bandeiras consideradas</dt>
              <dd>
                {voucher.brands.length === 0
                  ? "nenhuma"
                  : voucher.brands.map((brand) => `${brand.brand} ${bpsText(brand.rateBps)}${voucher.basis === "sales_weighted" ? ` (${percent(brand.share, 0)} das vendas)` : ""}`).join(" · ")}
              </dd>
            </div>
          </dl>
          {voucher.missingRateBrands.length > 0 && <p className="mt-1 text-xs text-destructive">Bandeira com venda e sem taxa cadastrada: {voucher.missingRateBrands.join(", ")}.</p>}
          {voucher.basis === "simple_average" && <p className="mt-1 text-xs text-muted-foreground">Poucas vendas de VR/VA para ponderar por bandeira: a taxa é a média simples das cadastradas.</p>}
        </div>
      )}
    </div>
  );
}
