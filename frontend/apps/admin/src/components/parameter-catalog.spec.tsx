import { describe, it, expect } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { ParameterCatalog, type ParameterKindSection, type ParameterRuleRow } from "./parameter-catalog";

function row(overrides: Partial<ParameterRuleRow> = {}): ParameterRuleRow {
  return {
    path: "group.param",
    label: "Parâmetro de teste",
    group: "group",
    groupLabel: "Grupo de teste",
    kind: "analytic",
    formattedValue: "42%",
    fallbackFormattedValue: "40%",
    isOverridden: true,
    isProvisional: true,
    controls: "Controla o teste.",
    formula: "a ÷ b",
    unitLabel: "proporção (mostrada em %)",
    minFormatted: "0%",
    maxFormatted: "100%",
    why: "Motivo de teste.",
    usedIn: "Usado no teste.",
    up: "Sobe o teste.",
    down: "Desce o teste.",
    envName: "NEXT_PUBLIC_TEST_GROUP_PARAM",
    ...overrides,
  };
}

const sections: ParameterKindSection[] = [
  {
    kind: "business",
    title: "Regras de negócio",
    description: "Descrição de negócio.",
    rows: [row({ path: "biz.provisional", label: "Regra provisória", group: "biz", groupLabel: "Grupo de negócio", formattedValue: "10%", isProvisional: true })],
  },
  {
    kind: "quality",
    title: "Critérios de qualidade",
    description: "Descrição de qualidade.",
    rows: [row({ path: "qual.approved", label: "Critério aprovado", group: "qual", groupLabel: "Grupo de qualidade", formattedValue: "80%", isProvisional: false, isOverridden: false })],
  },
];

describe("ParameterCatalog", () => {
  it("renders a card per section with its title, description and parameter count", () => {
    render(<ParameterCatalog sections={sections} />);

    expect(screen.getByText("Regras de negócio")).toBeInTheDocument();
    expect(screen.getByText("Descrição de negócio.")).toBeInTheDocument();
    expect(screen.getByText("Critérios de qualidade")).toBeInTheDocument();
    expect(screen.getByText("Descrição de qualidade.")).toBeInTheDocument();
    expect(screen.getAllByText("1 parâmetros")).toHaveLength(2);
  });

  it("renders every row's label and current value (once in the summary, once in the 'Valor atual' detail)", () => {
    render(<ParameterCatalog sections={sections} />);

    expect(screen.getByText("Regra provisória")).toBeInTheDocument();
    expect(screen.getAllByText("10%")).toHaveLength(2);
    expect(screen.getByText("Critério aprovado")).toBeInTheDocument();
    expect(screen.getAllByText("80%")).toHaveLength(2);
  });

  it("shows the provisório badge only for rows where isProvisional is true", () => {
    render(<ParameterCatalog sections={sections} />);

    // Only one of the two rows is provisional.
    expect(screen.getAllByText("provisório")).toHaveLength(1);
  });

  it("shows each row's group label as a section heading", () => {
    render(<ParameterCatalog sections={sections} />);

    expect(screen.getByRole("heading", { name: "Grupo de negócio" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Grupo de qualidade" })).toBeInTheDocument();
  });
});
