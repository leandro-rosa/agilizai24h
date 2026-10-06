import { AREA_EMPTY, buildAreaQuestions } from "./areas";
import { buildBrief, buildPageIntros, firstSentence } from "./brief";
import { fixtureInput, fixtureOverview } from "./test-fixtures";
import { buildOverview } from "./build";

/** Termos de finanças que NÃO podem aparecer no texto de apresentação (só no glossário e em tooltips). */
const BANNED = [/\bDRE\b/, /\bp\.p\./, /\bCAPEX\b/, /\bSKUs?\b/, /concilia[cç][aã]o/i, /margem de contribuição/i, /preço realizado/i, /\bmix\b/i, /resultado operacional/i, /margem operacional/i];
const CAUSE = [/\bcausou\b/i, /por causa d/i, /devido a/i, /\bem razão d/i];
const words = (s: string) => s.trim().split(/\s+/).length;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

function allText(o = fixtureOverview()): string[] {
  const b = buildBrief(o);
  const a = buildAreaQuestions(o);
  return [
    b.headline,
    ...b.cards.flatMap((c) => [c.question, c.title, c.value, c.sentence, c.light.label]),
    ...b.threeThings.flatMap((t) => [t.title, t.detail]),
    ...[...a.socios, ...a.operacao, ...a.financeiro].flatMap((q) => [q.question, q.answer]),
    ...Object.values(buildPageIntros(o)).flatMap((i) => [i.question, i.answer]),
  ];
}

describe("buildBrief", () => {
  it("setembro: vendeu menos, mas sobrou mais — em palavras do dia a dia", () => {
    const input = fixtureInput();
    const b = buildBrief(buildOverview({ ...input, months: [{ ...input.months[0], pnl: { ...input.months[0].pnl!, netRevenueCents: 11_000_000 } }, ...input.months.slice(1)] }));
    expect(b.headline).toMatch(/^Vendemos menos que em agosto, mas sobrou mais dinheiro depois de pagar os produtos\./);
    expect(b.headline).toMatch(/Perdemos menos produtos/);
    const rev = b.cards.find((c) => c.key === "revenue")!;
    expect(rev.question).toBe("Quanto vendemos?");
    expect(rev.value).toBe("R$ 110 mil");
    expect(rev.sentence).toMatch(/a menos que em agosto \(R\$ 123 mil\)\.$/);
    expect(rev.light.tone).toBe("worse");
    expect(b.cards.find((c) => c.key === "loss")!.light.tone).toBe("better"); // perdas caindo = melhor
    expect(b.cards.find((c) => c.key === "operatingMargin")!.value).toMatch(/^R\$ \d+$/);
    expect(b.threeThings.length).toBeLessThanOrEqual(3);
  });

  it("sem dados nunca vira 'parecido' nem zero", () => {
    const input = fixtureInput();
    const o = buildOverview({ ...input, months: input.months.map((m) => ({ ...m, finance: null, cash: null })) });
    const loss = buildBrief(o).cards.find((c) => c.key === "loss")!;
    expect(loss.light.tone).toBe("nodata");
    expect(loss.value).toBe("Sem dados");
    expect(buildBrief(o).headline).not.toMatch(/Perdemos/);
  });

  it("faturamento dentro da faixa de 3% é 'quase o mesmo', sem erro de concordância", () => {
    expect(buildBrief(fixtureOverview()).headline).toMatch(/^Vendemos quase o mesmo que em agosto, e sobrou mais dinheiro/);
  });

  it("todo texto sem jargão, sem causa e com frases curtas", () => {
    for (const t of allText()) {
      for (const re of BANNED) expect(t).not.toMatch(re);
      for (const re of CAUSE) expect(t).not.toMatch(re);
      for (const s of sentences(t)) expect(words(s)).toBeLessThanOrEqual(34);
    }
  });
});

describe("buildAreaQuestions", () => {
  it("cada área tem no máximo 3 perguntas, em forma de pergunta e com resposta", () => {
    const a = buildAreaQuestions(fixtureOverview());
    for (const list of [a.socios, a.operacao, a.financeiro]) {
      expect(list.length).toBeLessThanOrEqual(3);
      for (const q of list) {
        expect(q.question.endsWith("?")).toBe(true);
        expect(q.answer.length).toBeGreaterThan(5);
      }
    }
    expect(a.operacao[0].question).toBe("Qual foi o maior motivo de produtos perdidos?");
    expect(a.operacao[0].answer).toMatch(/Validade vencida|vencid/i);
    expect(a.financeiro.some((q) => q.question === "Há notas vencidas e ainda não pagas?")).toBe(true);
  });

  it("atraso curto de nota não vira alerta: diz que costuma ser pagamento ainda não baixado", () => {
    const q = buildAreaQuestions(fixtureOverview()).financeiro.find((x) => x.question.startsWith("Há notas vencidas"))!;
    expect(q.answer).toMatch(/Em geral é pagamento já feito e ainda não baixado/);
  });

  it("sem dados, a área fica vazia (a tela mostra AREA_EMPTY, nunca inventa)", () => {
    const input = fixtureInput();
    const o = buildOverview({ ...input, sales: null, aging: null, stores: { current: null, previous: null, activeCount: null }, months: input.months.map((m) => ({ ...m, finance: null, cash: null, treasury: null })) });
    const a = buildAreaQuestions(o);
    expect(a.operacao).toEqual([]);
    expect(a.financeiro).toEqual([]);
    expect(AREA_EMPTY).toMatch(/Nada fora do normal/);
  });
});

describe("buildPageIntros", () => {
  it("cada página tem pergunta, resposta e para quem costuma ser", () => {
    const intros = buildPageIntros(fixtureOverview());
    for (const i of Object.values(intros)) {
      expect(i.question.endsWith("?")).toBe(true);
      expect(i.answer.length).toBeGreaterThan(10);
      expect(i.audience.length).toBeGreaterThan(0);
    }
    expect(intros.precos.answer).toMatch(/^Sim: vendeu menos, mas sobrou mais dinheiro\./);
    expect(intros.perdas.answer).toMatch(/^Perdemos R\$ 4,2 mil em produtos, R\$ 535 a menos que em agosto\./);
  });

  it("sem dado, diz que não há dado em vez de inventar", () => {
    const input = fixtureInput();
    const o = buildOverview({ ...input, sales: null, months: input.months.map((m) => ({ ...m, finance: null, cash: null })) });
    const intros = buildPageIntros(o);
    expect(intros.perdas.answer).toBe("Sem dados de perdas neste mês.");
    expect(intros.financeiro.answer).toBe("Sem dados de caixa neste mês.");
    expect(intros.precos.answer).toMatch(/faltam vendas/);
  });
});


describe("firstSentence", () => {
  it("não corta em 'vs.' nem em número, só em ponto seguido de maiúscula", () => {
    expect(firstSentence("Receita -2,1% (R$ 1 → R$ 2) e margem +9,7% vs. ago/2026. Segunda frase.")).toBe("Receita -2,1% (R$ 1 → R$ 2) e margem +9,7% vs. ago/2026.");
    expect(firstSentence("Só uma frase")).toBe("Só uma frase.");
  });
});
