import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import type { CostStructure } from "../../lib/api/pricing";
import { CostSources } from "./cost-sources";

const structure = (over: Partial<CostStructure> = {}): CostStructure =>
  ({
    productCostCents: 570, lossAdjustedCostCents: 594, taxRate: 0.0707, lossRate: 0.04, lossLevel: "category", paymentRate: 0.028, paymentFixedCents: 5, voucherShare: 0.214, voucherBasis: "simple_average", operatingShare: 0.0115, statement: "x",
    paymentLevel: "product", paymentMixLines: 42,
    lossBasis: { lostUnits: 582, suppliedUnits: 14383, soldUnits: 13481, unaccountedUnits: 320, definition: "d" },
    paymentVoucher: { rateBps: 325, fixedCents: 0, basis: "simple_average", receiptLines: 9, minReceiptLines: 50, brands: [{ brand: "Alelo", rateBps: 300, fixedCents: 0, share: 0.5 }, { brand: "Ticket", rateBps: 350, fixedCents: 0, share: 0.5 }], missingRateBrands: [] },
    ...over,
  }) as CostStructure;

describe("CostSources — a perda e as taxas com a fonte à vista", () => {
  it("mostra a perda e a FONTE por extenso, nunca só 'perda: 4%'", () => {
    render(<CostSources structure={structure()} names={{ product: "Monster", category: "Bebidas" }} />);
    const loss = screen.getByTestId("loss-source");

    expect(loss).toHaveTextContent("Perda utilizada: 4,0%");
    expect(loss).toHaveTextContent("Fonte: Categoria — Bebidas");
    expect(loss).toHaveTextContent("582 un. removidas como perda ÷ 14.383 un. abastecidas");
    expect(loss).toHaveTextContent("abastecido sem venda nem perda: 320 un.");
    expect(loss).not.toHaveTextContent("un..");
  });

  it.each([
    ["product", "Fonte: Produto — Monster"],
    ["category", "Fonte: Categoria — Bebidas"],
    ["store", "Fonte: Loja — Loja Centro"],
    ["network", "Fonte: Rede — todas as lojas"],
  ] as const)("a fonte %s é dita", (level, text) => {
    render(<CostSources structure={structure({ lossLevel: level })} names={{ product: "Monster", category: "Bebidas", store: "Loja Centro" }} />);

    expect(screen.getByTestId("loss-source")).toHaveTextContent(text);
  });

  it("produto novo com perda de categoria diz que não há histórico; produto existente diz que o histórico próprio é insuficiente", () => {
    const first = render(<CostSources structure={structure()} names={{ category: "Bebidas" }} newProduct />);
    expect(screen.getByTestId("loss-source")).toHaveTextContent("Produto sem histórico. Utilizada perda da categoria.");
    first.unmount();

    render(<CostSources structure={structure()} names={{ category: "Bebidas" }} />);
    expect(screen.getByTestId("loss-source")).not.toHaveTextContent("Produto sem histórico");
    expect(screen.getByTestId("loss-source")).toHaveTextContent("histórico próprio do produto é insuficiente");
  });

  it("perda do próprio produto não leva nenhuma frase de 'sem histórico'", () => {
    render(<CostSources structure={structure({ lossLevel: "product" })} names={{ product: "Monster" }} />);

    expect(screen.getByTestId("loss-source")).not.toHaveTextContent("sem histórico");
    expect(screen.getByTestId("loss-source")).not.toHaveTextContent("insuficiente");
  });

  it("VR/VA: participação, taxa efetiva, método, bandeiras e volume (média simples)", () => {
    render(<CostSources structure={structure()} names={{}} />);
    const detail = screen.getByTestId("voucher-detail");

    expect(detail).toHaveTextContent("Média simples das bandeiras cadastradas");
    expect(detail).toHaveTextContent("21,4%");
    expect(detail).toHaveTextContent("3,25%");
    expect(detail).toHaveTextContent("9 linhas de venda com VR/VA (mínimo 50 para ponderar)");
    expect(detail).toHaveTextContent("Alelo 3,00%");
    expect(detail).toHaveTextContent("Ticket 3,50%");
    expect(detail).not.toHaveTextContent("das vendas)");
  });

  it("VR/VA ponderado por vendas mostra o peso de cada bandeira", () => {
    render(
      <CostSources
        structure={structure({ voucherShare: 0.282, voucherBasis: "sales_weighted", paymentVoucher: { rateBps: 320, fixedCents: 0, basis: "sales_weighted", receiptLines: 2400, minReceiptLines: 50, brands: [{ brand: "Alelo", rateBps: 300, fixedCents: 0, share: 0.75 }, { brand: "Ticket", rateBps: 380, fixedCents: 0, share: 0.25 }], missingRateBrands: ["NOVA"] } })}
        names={{}}
      />,
    );
    const detail = screen.getByTestId("voucher-detail");

    expect(detail).toHaveTextContent("Média ponderada pelas vendas de cada bandeira");
    expect(detail).toHaveTextContent("Alelo 3,00% (75% das vendas)");
    expect(detail).toHaveTextContent("Ticket 3,80% (25% das vendas)");
    expect(detail).toHaveTextContent("Bandeira com venda e sem taxa cadastrada: NOVA.");
  });

  it("sem VR/VA no mix não mostra o quadro", () => {
    render(<CostSources structure={structure({ voucherShare: 0, voucherBasis: "none", paymentVoucher: { rateBps: null, fixedCents: 0, basis: "none", receiptLines: 0, minReceiptLines: 50, brands: [], missingRateBrands: [] } })} names={{}} />);

    expect(screen.queryByTestId("voucher-detail")).not.toBeInTheDocument();
  });

  it("diz o mix de pagamento usado (produto, categoria ou rede) e as linhas por trás", () => {
    render(<CostSources structure={structure({ paymentLevel: "category", paymentMixLines: 11220 })} names={{}} />);

    expect(screen.getByTestId("payment-source")).toHaveTextContent("Mix de pagamento da categoria — 11.220 linhas de venda");
  });
});
