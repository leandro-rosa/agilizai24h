import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import type { PricingProduct } from "../../lib/api/pricing";

const startRun = jest.fn((_arg: unknown) => ({ unwrap: async () => ({ started: true }) }));
let latest: Record<string, unknown> = {};
let runHistory: unknown[] = [];
let olderRun: unknown;
let lastChange: { latest: string | null } | undefined;
let searchParams = new URLSearchParams();
const excel = jest.fn();

jest.doMock("next/navigation", () => ({ useSearchParams: () => searchParams }));
jest.doMock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.doMock("../../lib/api/pricing", () => ({
  useGetLatestPricingReportQuery: () => ({ data: latest, isLoading: false, isFetching: false, error: undefined, refetch: jest.fn() }),
  useStartPricingRunMutation: () => [startRun, { isLoading: false }],
  useGetPricingDecisionsQuery: () => ({ data: [] }),
  useGetPricingRunHistoryQuery: () => ({ data: runHistory }),
  useGetPricingRunReportQuery: (id: string) => ({ data: id === "OLD" ? olderRun : undefined }),
  useSimulatePriceMutation: () => [jest.fn(), { isLoading: false }],
  useGetProductHistoryQuery: () => ({ data: undefined, isLoading: true }),
  useGetProductStoresQuery: () => ({ data: undefined, isLoading: true }),
  useApplyPriceMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.doMock("../../lib/api/products", () => ({ useGetCatalogueLastChangeQuery: () => ({ data: lastChange }) }));
jest.doMock("../../lib/api/stores", () => ({ useGetStoresQuery: () => ({ data: [] }) }));
jest.doMock("../../lib/auth/use-permission", () => ({ useHasPermission: () => true }));
jest.doMock("../../lib/pricing/excel", () => ({ downloadWorkbook: excel }));
jest.doMock("./scope-bar", () => ({ ScopeBar: () => <div data-testid="scope" /> }));
jest.doMock("./rules-dialog", () => ({ RulesDialog: () => null }));
jest.doMock("./support-sections", () => ({ CategoriesSection: () => null, CostChangesSection: () => null, OpportunitiesSection: () => null }));
jest.doMock("../../components/request-state", () => ({ RequestState: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const product = (over: Partial<PricingProduct> = {}): PricingProduct =>
  ({
    sku: "COCA", name: "Coca-Cola Lata 350ml", ean: "789490001537", supplierId: 9, supplierName: "FEMSA", category: "beverage", categoryLabel: "Bebidas", subcategory: null, status: "adjust", confidence: "high",
    minimumPriceCents: 560, targetPriceCents: 610, recommendedPriceCents: 650, currentPriceCents: 590, currentMargin: 0.321, currentMarkup: 1.9, targetMargin: 0.35, minimumMargin: 0.3, marginFromCategory: false,
    structure: { productCostCents: 309, lossAdjustedCostCents: 315, taxRate: 0.0707, lossRate: 0.02, lossLevel: "product", paymentRate: 0.02, paymentFixedCents: 0, voucherShare: 0.22, voucherBasis: "sales_weighted", operatingShare: 0.04, statement: "Rateio operacional utilizado exclusivamente para análise de preço. Não representa novo lançamento financeiro." },
    costVariation: null, marginAtPreviousCost: null, marginChangeFromCost: null, monthlyUnits: 325, monthlyRevenueCents: 191750, monthlyMarginCents: 80000, impactCentsPerMonth: 42000, impactLabel: "Impacto potencial estimado",
    recommendedMargin: 0.35, reasons: [], insufficientReasons: [], engineVersion: "pricing-4", costOrigin: { source: "invoice", effectiveFrom: "2026-08-15", invoiceNumber: "13021" }, newerCost: null, ...over,
  }) as PricingProduct;

const report = (products: PricingProduct[], over: Record<string, unknown> = {}) => ({
  meta: { engineVersion: "pricing-4", parameterVersion: 7, months: ["2026-07", "2026-08", "2026-09"], asOf: "2026-09-30", storeId: null, payment: null, paymentMixMonthsWithoutTransactions: [], operating: null, notes: [] },
  summary: { analysed: products.length, averageMargin: 0.321, targetMargin: 0.35, withinTarget: 0, belowTarget: 1, opportunities: 0, insufficientData: 1, review: 0, potentialImpactCentsPerMonth: 42000, impactLabel: "Impacto potencial estimado", coverage: { total: 2, analysable: 1, withoutEnoughData: 1 }, pending: [{ code: "stale_cost", label: "Custo desatualizado (sem compra no período)", skus: ["MARM"] }], shares: { withinTarget: 0, belowTarget: 1, opportunities: 0, insufficientData: 0 } },
  categories: [],
  products,
  ...over,
});

const marmita = () => product({ sku: "MARM", name: "Marmita", status: "insufficient_data", recommendedPriceCents: null, impactCentsPerMonth: null, currentMargin: null, structure: null, insufficientReasons: ["Custo desatualizado (300 dias, sem compra no período)"], costOrigin: { source: "legacy_import", effectiveFrom: "2026-01-01", invoiceNumber: null } });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PricingScreen }: { PricingScreen: ComponentType } = require("./pricing-screen");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProductsTable }: { ProductsTable: ComponentType<Record<string, unknown>> } = require("./products-table");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PendingProducts }: { PendingProducts: ComponentType<Record<string, unknown>> } = require("./pending-products");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ExportButtons }: { ExportButtons: ComponentType<Record<string, unknown>> } = require("./export-buttons");

beforeEach(() => {
  jest.clearAllMocks();
  searchParams = new URLSearchParams();
  runHistory = [];
  olderRun = undefined;
  // O cadastro mudou em 09/10, depois do cálculo de 05/10.
  lastChange = { latest: "2026-10-09T00:00:00.000Z" };
  latest = { scope: { period: "2026-09", storeId: null }, state: "ready", run: { id: "r1", period: "2026-09", storeId: null, status: "completed", engineVersion: "pricing-4", parameterVersion: 7, computedAt: "2026-10-05T10:00:00.000Z", createdAt: "2026-10-05T09:59:00.000Z", error: null }, report: report([product(), marmita()]), inProgress: null, lastFailure: null, currentParameterVersion: 7, parametersStale: false };
});

describe("PricingScreen — a tela de análise", () => {
  it("mostra a meta padrão no cabeçalho e não repete a coluna Meta quando todos têm a mesma", () => {
    render(<PricingScreen />);

    expect(screen.getByText(/meta padrão/)).toHaveTextContent("meta padrão 35%");
    expect(screen.queryByRole("columnheader", { name: "Meta" })).not.toBeInTheDocument();
  });

  it("com metas diferentes a coluna Meta volta e o cabeçalho avisa das exceções", () => {
    latest = { ...latest, report: report([product(), product({ sku: "OUTRO", name: "Outro", targetMargin: 0.4 })]) };
    render(<PricingScreen />);

    expect(screen.getByRole("columnheader", { name: "Meta" })).toBeInTheDocument();
    expect(screen.getByText(/há exceções por produto\/categoria/)).toBeInTheDocument();
  });

  it("a ficha do cálculo mostra o motor, as regras, o período e as bases; é uma análise histórica do período", () => {
    render(<PricingScreen />);

    expect(screen.getByRole("region", { name: "Ficha do cálculo" })).toHaveTextContent("pricing-4 · regras v7");
    expect(screen.getByText(/Análise histórica de/)).toHaveTextContent("custo vigente no último dia do período");
  });

  it("avisa quando o cadastro mudou depois do cálculo e diz que o preço vigente continua até a aprovação", () => {
    render(<PricingScreen />);

    expect(screen.getByRole("status")).toHaveTextContent("Há custos, preços ou produtos novos no cadastro desde este cálculo");
    expect(screen.getByRole("status")).toHaveTextContent("O preço vigente continua valendo até alguém aprovar um novo");
  });

  it("sem alteração depois do cálculo, ou sem a leitura do cadastro, não avisa nada", () => {
    latest = { ...(latest as object), run: { ...((latest as { run: object }).run), computedAt: "2026-10-10T00:00:00.000Z" } };
    const { unmount } = render(<PricingScreen />);
    expect(screen.queryByText(/desde este cálculo/)).not.toBeInTheDocument();
    unmount();

    lastChange = undefined;
    render(<PricingScreen />);
    expect(screen.queryByText(/desde este cálculo/)).not.toBeInTheDocument();
  });

  it("tem um só botão Exportar, e a pendência de produtos sem dados está visível e clicável", () => {
    render(<PricingScreen />);

    expect(screen.getByRole("button", { name: /Exportar/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Exportar Excel/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Produtos sem dados suficientes" })).toBeInTheDocument();
  });

  it("?sku= abre o detalhe do produto direto, com o caminho de volta ao cadastro", () => {
    searchParams = new URLSearchParams("sku=COCA");
    render(<PricingScreen />);

    expect(screen.getByRole("link", { name: "Editar cadastro" })).toHaveAttribute("href", "/products?sku=COCA&tab=overview");
  });
});

describe("Detalhe do produto — como o número foi calculado", () => {
  const open = (p: PricingProduct) => {
    searchParams = new URLSearchParams(`sku=${p.sku}`);
    latest = { ...latest, report: report([p]) };
    render(<PricingScreen />);
  };

  it("explica o método e a origem do custo, os impostos e taxas, o tipo de margem, a meta e a premissa do impacto", () => {
    open(product());

    const section = screen.getByRole("heading", { name: "Como este número foi calculado" }).closest("section") as HTMLElement;
    expect(section).toHaveTextContent("custo vigente no último dia de");
    expect(section).toHaveTextContent("a mesma regra do CMV do financeiro");
    expect(section).toHaveTextContent("origem: Nota fiscal 13021 · desde 15/08/2026");
    expect(section).toHaveTextContent("Imposto 7,07% · taxas de pagamento 2,00%");
    expect(section).toHaveTextContent("perda 2,0% (do produto)");
    expect(section).toHaveTextContent("Margem de contribuição: o que sobra do preço");
    expect(section).toHaveTextContent("35% (meta padrão) · margem mínima 30%");
    expect(section).toHaveTextContent("supõe o mesmo volume de vendas");
  });

  it("o motor e a versão das regras só aparecem nos detalhes técnicos, para auditoria", () => {
    open(product());

    const details = screen.getByText("Detalhes técnicos (auditoria)").closest("details") as HTMLElement;
    expect(details).toHaveTextContent("Motor pricing-4 · regras v7");
    expect(details).not.toHaveAttribute("open");
  });

  it("um custo novo depois do período é dito à parte e o período segue histórico", () => {
    open(product({ newerCost: { costCents: 350, effectiveFrom: "2026-10-10", source: "invoice" } }));

    const section = screen.getByRole("heading", { name: "Como este número foi calculado" }).closest("section") as HTMLElement;
    expect(section).toHaveTextContent("O cadastro tem um custo mais novo (R$ 3,50, desde 10/10/2026, de compra recebida). Este período é histórico: o custo novo não entra nele");
  });

  it("uma meta de categoria é dita como tal", () => {
    open(product({ marginFromCategory: true, targetMargin: 0.4 }));

    expect(screen.getByText(/40% \(meta da categoria\)/)).toBeInTheDocument();
  });
});

describe("Detalhe do produto — os três números, as três bases de custo e a validação", () => {
  const open = (p: PricingProduct, meta: Record<string, unknown> = {}) => {
    searchParams = new URLSearchParams(`sku=${p.sku}`);
    const base = report([p]);
    latest = { ...latest, report: { ...base, meta: { ...base.meta, ...meta } } };
    render(<PricingScreen />);
  };
  const contribution = {
    unitContributionCents: 210.9,
    estimatedResultAfterAllocation: { centsPerUnit: 181.4, margin: 0.307, criterion: "Contribuição menos deslocamento por visita e custos fixos (5,0% da receita de vendas das lojas, rede, 2026-09) aplicados ao preço; é uma estimativa que depende deste critério, não o lucro líquido" },
    validated: true,
    validationNotes: [],
    costBases: {
      historical: { costCents: 309, effectiveFrom: "2026-08-15", source: "invoice", basis: "received_purchase" },
      lastPurchase: { costCents: 350, effectiveFrom: "2026-10-02", invoiceNumber: "13990" },
      registry: { costCents: 400, effectiveFrom: "2026-10-04", source: "manual" },
    },
    atLastPurchaseCost: { basis: "received_purchase", costCents: 350, effectiveFrom: "2026-10-02", targetPriceCents: 690, marginAtCurrentPrice: 0.26 },
    reconciliation: { oldMargin: 0.32, newMargin: 0.37, lines: [{ label: "Custos fixos saíram do preço (resultado operacional e ponto de equilíbrio)", points: 0.04 }, { label: "Deslocamento por visita saiu do preço (viabilidade da rota ou loja)", points: 0.01 }], unexplainedPoints: 0 },
  } satisfies Partial<PricingProduct>;

  it("mostra a margem de contribuição, a contribuição por unidade e o resultado após rateio com o critério, sem chamá-lo de lucro", () => {
    open(product(contribution as Partial<PricingProduct>));

    expect(screen.getByText("Margem de contribuição", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Contribuição por unidade", { selector: "p" }).parentElement).toHaveTextContent("R$ 2,11");
    const result = screen.getByText("Resultado após rateio (estimativa)", { selector: "p" }).parentElement as HTMLElement;
    expect(result).toHaveTextContent("30,7%");
    expect(result).toHaveTextContent("não é lucro líquido");
    expect(screen.getByText(/Resultado após rateio: Contribuição menos deslocamento por visita e custos fixos/)).toHaveTextContent("rede, 2026-09");
  });

  it("separa o custo histórico, a última compra recebida e o custo manual, e nunca chama o manual de compra confirmada", () => {
    open(product(contribution as Partial<PricingProduct>));

    const section = screen.getByRole("heading", { name: "Qual custo é este?" }).closest("section") as HTMLElement;
    expect(section).toHaveTextContent("R$ 3,09 desde 15/08/2026 · compra recebida e confirmada");
    expect(section).toHaveTextContent("R$ 3,50, recebida em 02/10/2026 · nota 13990");
    expect(section).toHaveTextContent("R$ 4,00 desde 04/10/2026 · origem: digitado à mão");
    expect(section).toHaveTextContent("Não é uma compra confirmada");
    expect(section).toHaveTextContent("Sugestão atual, ao custo da última compra recebida");
    expect(section).toHaveTextContent("preço-meta R$ 6,90");
    expect(section).toHaveTextContent("não garante o custo exato de cada venda do mês");
  });

  it("uma compra sem nota aparece como compra recebida sem nota, e sem compra o texto diz que não há", () => {
    open(product({ ...(contribution as Partial<PricingProduct>), costBases: { historical: null, lastPurchase: { costCents: 350, effectiveFrom: "2026-10-02", invoiceNumber: null }, registry: null }, atLastPurchaseCost: null }));
    expect(screen.getByRole("heading", { name: "Qual custo é este?" }).closest("section")).toHaveTextContent("recebida em 02/10/2026 · sem nota");
  });

  it("o custo histórico manual é dito sem compra recebida", () => {
    open(product({ ...(contribution as Partial<PricingProduct>), costBases: { historical: { costCents: 309, effectiveFrom: "2026-08-15", source: "manual", basis: "registry_or_manual" }, lastPurchase: null, registry: null }, atLastPurchaseCost: null }));

    const section = screen.getByRole("heading", { name: "Qual custo é este?" }).closest("section") as HTMLElement;
    expect(section).toHaveTextContent("custo cadastral ou manual, sem compra recebida");
    expect(section).toHaveTextContent("Nenhuma compra recebida registrada");
  });

  it("não validado: o número aparece, com o selo e as notas de valor, período e escopo", () => {
    open(product({ ...(contribution as Partial<PricingProduct>), validated: false, validationNotes: ["Cálculo incompleto: R$ 900,00 em despesas sem classificação (0,30% da receita de vendas das lojas, rede, 2026-07, 2026-08, 2026-09): 4.2.07 Marketing"] }));

    expect(screen.getByText("Não validado: despesas sem classificação")).toBeInTheDocument();
    expect(screen.getByText(/Cálculo incompleto: R\$ 900,00/)).toBeInTheDocument();
    expect(screen.getByText("R$ 6,50", { selector: "p" })).toBeInTheDocument(); // the recommendation is still there
  });

  it("validado não mostra selo nem notas de incompletude", () => {
    open(product(contribution as Partial<PricingProduct>));

    expect(screen.queryByText("Não validado: despesas sem classificação")).not.toBeInTheDocument();
  });

  it("a comparação com o cálculo anterior lista cada diferença e o que não fecha", () => {
    open(product(contribution as Partial<PricingProduct>));

    const comparison = screen.getByText(/Comparação com o cálculo anterior/).closest("details") as HTMLElement;
    expect(comparison).toHaveTextContent("margem econômica 32,0% → contribuição 37,0%");
    expect(comparison).toHaveTextContent("Custos fixos saíram do preço");
    expect(comparison).toHaveTextContent("+4,0 p.p.");
    expect(comparison).toHaveTextContent("Deslocamento por visita saiu do preço");
    expect(comparison).toHaveTextContent("Não explicado");
  });
});

describe("Aviso de cálculo incompleto na tela", () => {
  const withOperating = (operating: Record<string, unknown> | null) => {
    const base = report([product(), marmita()]);
    latest = { ...latest, report: { ...base, meta: { ...base.meta, operating } } };
  };

  it("é fixo, mostra valor, período e escopo e leva às regras", () => {
    withOperating({ scope: "rede", months: ["2026-07", "2026-08", "2026-09"], revenueCents: 29_729_312, complete: false, unclassified: [{ code: "4.2.07", label: "Marketing", amountCents: 90_000 }], unclassifiedCents: 90_000, unclassifiedShare: 0.003, classes: {}, percentOfSalesShare: 0.01, perTransaction: null, legacy: { share: 0.2, costCents: 1, accounts: [] } });
    render(<PricingScreen />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Cálculo incompleto: R$ 900,00 em despesas sem classificação");
    expect(alert).toHaveTextContent("escopo: rede");
    expect(alert).toHaveTextContent("2026-07, 2026-08, 2026-09");
    expect(alert).toHaveTextContent("Nenhuma recomendação está validada");
    expect(screen.getByRole("button", { name: "Classificar despesas" })).toBeInTheDocument();
  });

  it("sem despesa pendente não há aviso", () => {
    withOperating({ scope: "rede", months: ["2026-09"], revenueCents: 1, complete: true, unclassified: [], unclassifiedCents: 0, unclassifiedShare: 0, classes: {}, percentOfSalesShare: 0.01, perTransaction: null, legacy: { share: 0.2, costCents: 1, accounts: [] } });
    render(<PricingScreen />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("um relatório do motor anterior diz que a margem dele é a econômica e pede para recalcular", () => {
    withOperating({ share: 0.2335, months: ["2026-09"], accounts: [] });
    render(<PricingScreen />);

    expect(screen.getByRole("alert")).toHaveTextContent("calculado pelo motor anterior");
    expect(screen.getByRole("alert")).toHaveTextContent("margem de contribuição, que é a que a meta de 35% orienta");
  });
});

describe("ProductsTable — colunas enxutas", () => {
  const props = (rows: PricingProduct[], extra: Record<string, unknown> = {}) => ({ rows, total: rows.length, page: 1, pages: 1, pageSize: 10, onPageChange: jest.fn(), onPageSizeChange: jest.fn(), onOpen: jest.fn(), ...extra });

  it("tem produto, custo utilizado, preço vigente, margem, preço sugerido, impacto, situação e Analisar", () => {
    render(<ProductsTable {...props([product()])} />);

    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Produto", "Custo utilizado", "Preço vigente", "Margem de contribuição", "Preço sugerido", "Impacto mensal estimado", "Situação", ""]);
  });

  it("o cabeçalho da margem diz o que ela é e o do impacto diz a premissa", () => {
    render(<ProductsTable {...props([product()])} />);

    expect(screen.getByRole("columnheader", { name: "Margem de contribuição" })).toHaveAttribute("title", expect.stringContaining("Margem de contribuição"));
    expect(screen.getByRole("columnheader", { name: "Impacto mensal estimado" })).toHaveAttribute("title", expect.stringContaining("mesmo volume de vendas"));
  });

  it("o custo vem com a origem; um custo novo depois do período aparece à parte, nunca como o custo do período", () => {
    render(<ProductsTable {...props([product({ newerCost: { costCents: 350, effectiveFrom: "2026-10-10", source: "invoice" } })])} />);

    const row = screen.getByText("Coca-Cola Lata 350ml").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("R$ 3,09");
    expect(row).toHaveTextContent("Nota fiscal 13021 · desde 15/08/2026");
    expect(row).toHaveTextContent("Custo novo depois do período: R$ 3,50");
  });

  it("produto sem dados mostra traço na margem e o motivo, nunca zero", () => {
    render(<ProductsTable {...props([marmita()])} />);

    const row = screen.getByText("Marmita").closest("tr") as HTMLElement;
    expect(row).not.toHaveTextContent("0,0%");
    expect(row).toHaveTextContent("Custo desatualizado");
  });
});

describe("PendingProducts", () => {
  const groups = [
    { code: "stale_cost", label: "Custo desatualizado (sem compra no período)", skus: ["MARM", "OUTRO"] },
    { code: "no_price", label: "Sem preço de venda cadastrado", skus: ["MARM"] },
  ];
  const draw = (onOpen = jest.fn()) => render(<PendingProducts groups={groups} products={[marmita(), product({ sku: "OUTRO", name: "Outro" })]} onOpen={onOpen} />);

  it("mostra os motivos com a contagem e, ao clicar, os produtos com o caminho para corrigir", () => {
    draw();
    expect(screen.getByRole("button", { name: "Custo desatualizado (sem compra no período): 2" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Custo desatualizado/ }));
    const list = screen.getByRole("list", { name: "Custo desatualizado (sem compra no período)" });
    expect(list).toHaveTextContent("Marmita");
    expect(screen.getAllByRole("link", { name: "Corrigir custo" })[0]).toHaveAttribute("href", "/products?sku=MARM&tab=costs");
  });

  it("sem preço leva a definir o preço, e Ver análise abre o produto na própria tela", () => {
    const onOpen = jest.fn();
    draw(onOpen);
    fireEvent.click(screen.getByRole("button", { name: /Sem preço de venda/ }));

    expect(screen.getByRole("link", { name: "Definir preço" })).toHaveAttribute("href", "/products?sku=MARM&tab=prices");
    fireEvent.click(screen.getByRole("button", { name: "Ver análise" }));
    expect(onOpen).toHaveBeenCalledWith("MARM");
  });

  it("sem pendências não ocupa lugar", () => {
    const { container } = render(<PendingProducts groups={[]} products={[]} onOpen={jest.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ExportButtons", () => {
  it("é um botão Exportar só, desligado e explicado enquanto não há relatório", () => {
    render(<ExportButtons model={null} unavailableReason="Aguarde o relatório carregar." />);

    const button = screen.getByRole("button", { name: /Exportar/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Aguarde o relatório carregar.");
  });
});

describe("Relatórios antigos continuam legíveis, com a métrica que tinham", () => {
  const oldReport = () => {
    const base = report([product({ engineVersion: "pricing-3", unitContributionCents: undefined, estimatedResultAfterAllocation: undefined, validated: undefined, validationNotes: undefined, costBases: undefined, reconciliation: undefined })]);
    return { ...base, meta: { ...base.meta, engineVersion: "pricing-3", parameterVersion: 2, operating: { share: 0.2335, months: ["2026-07", "2026-08", "2026-09"], accounts: [] } } };
  };
  const useOld = () => {
    latest = { ...latest, run: { ...(latest.run as object), engineVersion: "pricing-3", parameterVersion: 2 }, report: oldReport() };
  };

  it("a ficha diz a métrica ORIGINAL com a definição de então, o motor, as regras, o período e as bases, sem renomear a margem econômica", () => {
    useOld();
    render(<PricingScreen />);
    const sheet = screen.getByRole("region", { name: "Ficha do cálculo" });

    expect(sheet).toHaveTextContent("Cálculo anterior: margem econômica");
    expect(sheet).toHaveTextContent("Margem econômica: o que sobra do preço depois do custo, das perdas, dos impostos, das taxas de pagamento e do rateio operacional.");
    expect(sheet).toHaveTextContent("pricing-3 · regras v2");
    expect(sheet).toHaveTextContent("jul/2026 a set/2026");
    expect(sheet).toHaveTextContent("custo, preço e taxas vigentes em 30/09/2026");
    expect(sheet).toHaveTextContent("não foram alterados");
    expect(screen.getByRole("columnheader", { name: "Margem econômica" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Margem de contribuição" })).not.toBeInTheDocument();
  });

  it("no detalhe do produto antigo a margem é a econômica e não aparecem números que aquele cálculo não tinha", () => {
    useOld();
    searchParams = new URLSearchParams("sku=COCA");
    render(<PricingScreen />);

    expect(screen.getByText("Margem econômica", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Contribuição por unidade", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.queryByText("Resultado após rateio (estimativa)", { selector: "p" })).not.toBeInTheDocument();
  });

  it("um cálculo mais antigo da lista abre como foi calculado, só para leitura: sem simular nem aplicar preço", () => {
    const current = { id: "new", period: "2026-09", storeId: null, status: "completed", engineVersion: "pricing-4", parameterVersion: 3, computedAt: "2026-10-08T10:00:00.000Z", createdAt: "2026-10-08T09:59:00.000Z", error: null };
    const older = { ...current, id: "OLD", engineVersion: "pricing-3", parameterVersion: 2, computedAt: "2026-10-05T10:00:00.000Z" };
    runHistory = [current, older];
    latest = { ...latest, run: current, currentParameterVersion: 3 };
    const base = report([product({ engineVersion: "pricing-3" })]);
    olderRun = { run: older, report: { ...base, meta: { ...base.meta, engineVersion: "pricing-3", parameterVersion: 2, operating: { share: 0.2335, months: ["2026-09"], accounts: [] } } } };

    // The current one first: it can be simulated.
    searchParams = new URLSearchParams("sku=COCA");
    const first = render(<PricingScreen />);
    expect(screen.getByRole("button", { name: "Simular outro preço" })).toBeInTheDocument();
    first.unmount();

    // The older one, opened by its link: read-only, with its own metric and versions.
    searchParams = new URLSearchParams("sku=COCA&run=OLD");
    render(<PricingScreen />);
    expect(screen.queryByRole("button", { name: "Simular outro preço" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Simulador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar novo preço" })).not.toBeInTheDocument();
    expect(screen.getByText(/Cálculo mais antigo, só para leitura/)).toBeInTheDocument();
    expect(screen.getByText("Margem econômica", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/Motor pricing-3 · regras v2 · calculado em 05\/10\/2026/)).toBeInTheDocument();
  });
});

describe("Deslocamento e taxa fixa: o que é média, aproximação e limite", () => {
  const travel = {
    scope: "rede",
    unit: "um abastecimento = uma loja atendida em uma operação de reposição (uma viagem que atende várias lojas conta várias)",
    perVisitCents: 12_500,
    usedCostCents: 250_000,
    usedVisits: 20,
    months: [
      { period: "2026-08", costCents: 150_000, visits: 12, perVisitCents: 12_500, status: "used" },
      { period: "2026-09", costCents: 100_000, visits: 8, perVisitCents: 12_500, status: "used" },
      { period: "2026-07", costCents: 90_000, visits: null, perVisitCents: null, status: "no_visits" },
    ],
    excludedMonths: [{ period: "2026-07", reason: "sem registro de abastecimentos no mês (desconhecido, não zero)" }],
    stores: [{ storeId: 1, visits: 12, estimatedCents: 150_000 }, { storeId: 2, visits: 8, estimatedCents: 100_000 }],
    limitations: ["Custo médio estimado por abastecimento (gasto de deslocamento ÷ abastecimentos do mesmo mês), não o custo real de uma rota ou de uma visita.", "A média não é exclusiva do minimercado.", "O valor por loja é um rateio estimado (média × abastecimentos da loja), não o custo real de chegar a ela."],
  };
  const classified = (over: Record<string, unknown> = {}) => ({ scope: "rede", months: ["2026-07", "2026-08", "2026-09"], revenueCents: 1, complete: true, unclassified: [], unclassifiedCents: 0, unclassifiedShare: 0, classes: {}, percentOfSalesShare: 0.01, perTransaction: null, travel, legacy: { share: 0.2, costCents: 1, accounts: [] }, ...over });

  it("mostra o custo médio estimado por abastecimento com o período, os valores usados, as exclusões e os limites", () => {
    const base = report([product(), marmita()]);
    latest = { ...latest, report: { ...base, meta: { ...base.meta, operating: classified() } } };
    render(<PricingScreen />);

    const card = screen.getByText(/Deslocamento: custo médio estimado por abastecimento/).closest("details") as HTMLElement;
    expect(card).toHaveTextContent("R$ 125,00");
    expect(card).toHaveTextContent("Gasto de deslocamento do mês ÷ abastecimentos realizados no mesmo mês (rede)");
    expect(card).toHaveTextContent("uma loja atendida em uma operação de reposição");
    expect(card).toHaveTextContent("jul/2026 fora da média: sem registro de abastecimentos no mês (desconhecido, não zero)");
    expect(card).toHaveTextContent("Meses usados");
    expect(card).toHaveTextContent("20");
    expect(card).toHaveTextContent("não é exclusiva do minimercado");
    expect(card).toHaveTextContent("não o custo real de uma rota ou de uma visita");
    expect(card).toHaveTextContent("Rateio estimado por loja");
  });

  it("sem abastecimentos não há média: o cartão diz indisponível, nunca custo zero", () => {
    const base = report([product(), marmita()]);
    latest = { ...latest, report: { ...base, meta: { ...base.meta, operating: classified({ travel: { ...travel, perVisitCents: null, usedCostCents: 0, usedVisits: 0, stores: [] } }) } } };
    render(<PricingScreen />);

    expect(screen.getByText(/Deslocamento: custo médio estimado por abastecimento/)).toHaveTextContent("indisponível");
  });

  it("a taxa fixa por unidade traz a aproximação dos tickets contados um por linha no detalhe do produto", () => {
    searchParams = new URLSearchParams("sku=COCA");
    const p = product();
    const structure = { ...(p.structure as object), paymentFixedCents: 17.8, paymentFixed: { basis: "line_approximation", note: "Total estimado: tarifa cadastrada × tickets (400), repartido pelas 500 unidades vendidas; não é o valor cobrado pelas adquirentes. Nenhuma linha traz o cupom: cada linha foi contada como um ticket (aproximação)." } };
    latest = { ...latest, report: report([{ ...p, structure } as PricingProduct]) };
    render(<PricingScreen />);

    const section = screen.getByRole("heading", { name: "Como este número foi calculado" }).closest("section") as HTMLElement;
    expect(section).toHaveTextContent("R$ 0,18 por unidade (taxa fixa repartida pelas unidades)");
    expect(section).toHaveTextContent("Aproximação: Total estimado");
    expect(section).toHaveTextContent("não é o valor cobrado pelas adquirentes");
  });
});
