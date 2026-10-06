import { classifyBehavior, distribution, distributionText } from "./product-behavior";

describe("classifyBehavior", () => {
  it("100,102,98,101,100 is estavel", () => expect(classifyBehavior([100, 102, 98, 101, 100])).toBe("estavel"));
  it("100,95,88,76,65 is queda consistente", () => expect(classifyBehavior([100, 95, 88, 76, 65])).toBe("queda_consistente"));
  it("rising steadily is crescimento consistente", () => expect(classifyBehavior([60, 70, 82, 95])).toBe("crescimento_consistente"));
  it("flat then jump is mudanca recente", () => expect(classifyBehavior([100, 101, 99, 100, 140])).toBe("mudanca_recente"));
  it("zigzag is volatil", () => expect(classifyBehavior([100, 40, 130, 50])).toBe("volatil"));
  it("started selling recently is novo", () => expect(classifyBehavior([0, 0, 0, 30, 50])).toBe("novo"));
  it("fewer than 4 months is dados_insuficientes", () => expect(classifyBehavior([10, 20, 30])).toBe("dados_insuficientes"));
  it("an ingestion hole is not read as a fall to zero", () => expect(classifyBehavior([100, 90, null, 80])).toBe("dados_insuficientes"));
});

describe("distribution", () => {
  it("growth spread over many stores is not concentrated", () => {
    const d = distribution([5, 5, 5, 5, 5, 5, 5, 5, -2, 0]);
    expect(d.direction).toBe("up");
    expect(d.storesAffected).toBe(8);
    expect(d.concentrated).toBe(false);
  });
  it("78% in 2 stores is concentrated", () => {
    const d = distribution([50, 28, 6, 6, 5, 5]);
    expect(d.concentrated).toBe(true);
    expect(d.topShare).toBeCloseTo(0.78);
  });
  it("no net movement is flat", () => expect(distribution([5, -5]).direction).toBe("flat"));
});

describe("distributionText", () => {
  it("says what is distributed and where", () => {
    expect(distributionText(distribution([50, 28, 6, 6, 5, 5]))).toBe("78% do aumento de unidades veio de 2 lojas");
    expect(distributionText(distribution([5, 5, 5, 5, 5, 5, 5, 5]))).toBe("aumento de unidades em 8 lojas");
    expect(distributionText(distribution([-5, -5, -5]))).toBe("queda de unidades em 3 lojas");
  });
  it("is null when nothing moved", () => expect(distributionText(distribution([5, -5]))).toBeNull());
});
