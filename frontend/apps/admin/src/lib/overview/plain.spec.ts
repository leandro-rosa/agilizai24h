import { friendlyMoney, moreOrLess, plainify, trafficLight } from "./plain";

describe("friendlyMoney", () => {
  it("arredonda para ler rápido", () => {
    expect(friendlyMoney(12_038_100)).toBe("R$ 120 mil");
    expect(friendlyMoney(419_500)).toBe("R$ 4,2 mil");
    expect(friendlyMoney(95_000)).toBe("R$ 950");
    expect(friendlyMoney(250_000_000)).toBe("R$ 2,5 milhão");
    expect(friendlyMoney(-357_600)).toBe("−R$ 3,6 mil");
    expect(friendlyMoney(null)).toBe("sem dados");
  });
  it("moreOrLess diz a mais / a menos", () => {
    expect(moreOrLess(357_600)).toBe("R$ 3,6 mil a mais");
    expect(moreOrLess(-357_600)).toBe("R$ 3,6 mil a menos");
    expect(moreOrLess(0)).toBe("igual");
  });
});

describe("trafficLight", () => {
  it("melhor, parecido e pior, com a faixa de 3%", () => {
    expect(trafficLight(0.1, 0.08, true).tone).toBe("better");
    expect(trafficLight(0.02, -0.01, true).tone).toBe("same");
    expect(trafficLight(-0.1, -0.08, true).tone).toBe("worse");
  });
  it("perdas: subir é pior, cair é melhor", () => {
    expect(trafficLight(0.2, 0.2, false).tone).toBe("worse");
    expect(trafficLight(-0.2, -0.2, false).tone).toBe("better");
  });
  it("as duas comparações discordando = parecido (oscilou)", () => {
    expect(trafficLight(0.1, -0.1, true).tone).toBe("same");
  });
  it("uma só comparação vale; nenhuma = sem dados, nunca parecido", () => {
    expect(trafficLight(null, 0.1, true).tone).toBe("better");
    expect(trafficLight(-0.1, null, true).tone).toBe("worse");
    expect(trafficLight(null, null, true).tone).toBe("nodata");
  });
  it("um parecido e um com direção: vale a direção", () => {
    expect(trafficLight(0.01, 0.1, true).tone).toBe("better");
  });
});

describe("plainify", () => {
  it("troca o vocabulário técnico", () => {
    const out = plainify("Margem de contribuição cresceu +5,0 p.p. e a receita líquida (DRE) foi de 3 SKUs; CAPEX do mês e conciliação incompleta.");
    expect(out).toBe("Lucro bruto cresceu +5,0 pontos e o faturamento foi de 3 produtos; investimento em equipamentos e lojas do mês e contagem de estoque com falhas.");
    expect(plainify(out)).toBe(out);
    expect(plainify("Receita +9% vs. ago/2026")).toBe("Receita +9% contra ago/2026");
  });
});
