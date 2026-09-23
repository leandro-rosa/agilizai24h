import { describe, it, expect } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { BusinessRulesSheet, businessRuleRowFrom, type BusinessRuleRow } from "./business-rules-sheet";
import type { ParameterRuleRow } from "./parameter-catalog";

const rows: BusinessRuleRow[] = [
  { path: "biz.b", label: "Regra B", formattedValue: "R$ 5,00", controls: "Controla B.", usedIn: "Usado em B." },
  { path: "biz.a", label: "Regra A", formattedValue: "10%", controls: "Controla A.", usedIn: "Usado em A." },
];

describe("BusinessRulesSheet", () => {
  it("renders the trigger button and, once opened, the description, every row's label/value and the calibration link", () => {
    render(<BusinessRulesSheet description="Descrição de teste das regras." rows={rows} calibrationHref="/somewhere/calibration" />);

    const trigger = screen.getByRole("button", { name: /regras de negócio/i });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getByText("Descrição de teste das regras.")).toBeInTheDocument();
    expect(screen.getByText("Regra A")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("Regra B")).toBeInTheDocument();
    expect(screen.getByText("R$ 5,00")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /configurações avançadas/i });
    expect(link).toHaveAttribute("href", "/somewhere/calibration");
  });

  it("sorts rows by label (pt-BR) regardless of the order given, and badges every row as padrão provisório", () => {
    render(<BusinessRulesSheet description="Descrição de teste." rows={rows} calibrationHref="/calibration" />);
    fireEvent.click(screen.getByRole("button", { name: /regras de negócio/i }));

    const labels = screen.getAllByText(/^Regra [AB]$/).map((el) => el.textContent);
    expect(labels).toEqual(["Regra A", "Regra B"]);

    expect(screen.getAllByText("padrão provisório")).toHaveLength(2);
  });
});

describe("businessRuleRowFrom", () => {
  it("projects a ParameterRuleRow down to the fields BusinessRuleRow needs", () => {
    const parameterRow: ParameterRuleRow = {
      path: "biz.margin",
      label: "Margem mínima",
      group: "biz",
      groupLabel: "Regras",
      kind: "business",
      formattedValue: "30%",
      fallbackFormattedValue: "30%",
      isOverridden: false,
      isProvisional: true,
      controls: "Controla a margem.",
      formula: null,
      unitLabel: "proporção (mostrada em %)",
      minFormatted: "0%",
      maxFormatted: "95%",
      why: "Motivo.",
      usedIn: "Usado em X.",
      up: "Sobe.",
      down: "Desce.",
      envName: "NEXT_PUBLIC_TEST_MARGIN",
    };

    expect(businessRuleRowFrom(parameterRow)).toEqual({
      path: "biz.margin",
      label: "Margem mínima",
      formattedValue: "30%",
      controls: "Controla a margem.",
      usedIn: "Usado em X.",
    });
  });
});
