import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { IncreaseCapNotice, ValidationNotice } from "./cap-notice";

describe("IncreaseCapNotice — o limite de aumento parou o preço antes da meta", () => {
  const cap = { targetPriceCents: 610, ceilingCents: 440, limitedPriceCents: 440, resultingMargin: 0.2273, targetMargin: 0.35, maxIncreaseBps: 1000, message: "Margem abaixo da meta devido ao limite máximo de aumento configurado." };

  it("diz a frase combinada, o preço da meta, o teto, o preço limitado e a margem que ele dá", () => {
    render(<IncreaseCapNotice cap={cap} />);
    const notice = screen.getByTestId("increase-cap");

    expect(notice).toHaveTextContent("Margem abaixo da meta devido ao limite máximo de aumento configurado.");
    expect(notice).toHaveTextContent(/seria R\$\s6,10/);
    expect(notice).toHaveTextContent("limite de aumento de 10%");
    expect(notice).toHaveTextContent(/permite no máximo R\$\s4,40/);
    expect(notice).toHaveTextContent(/preço limitado é R\$\s4,40/);
    expect(notice).toHaveTextContent("margem de contribuição de 22,7%");
  });
});

describe("ValidationNotice — precificação não validada, com o que falta", () => {
  it("mostra exatamente quais despesas falta classificar", () => {
    render(<ValidationNotice product={{ validated: false, status: "adjust", validationNotes: ["Precificação não validada: faltam classificar R$ 900,00 em despesas (3,0% da receita de vendas das lojas, rede): 4.2.07 Marketing"] }} />);

    expect(screen.getByTestId("validation-notice")).toHaveTextContent("Precificação não validada");
    expect(screen.getByTestId("validation-notice")).toHaveTextContent("faltam classificar R$ 900,00 em despesas");
    expect(screen.getByTestId("validation-notice")).toHaveTextContent("4.2.07 Marketing");
  });

  it("sem notas ainda diz o que fazer; validado ou sem dados não mostra nada", () => {
    const { container, rerender } = render(<ValidationNotice product={{ validated: false, status: "adjust", validationNotes: [] }} />);
    expect(container).toHaveTextContent("classifique-as em Regras de negócio");

    rerender(<ValidationNotice product={{ validated: true, status: "adjust", validationNotes: [] }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ValidationNotice product={{ validated: false, status: "insufficient_data", validationNotes: ["x"] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
