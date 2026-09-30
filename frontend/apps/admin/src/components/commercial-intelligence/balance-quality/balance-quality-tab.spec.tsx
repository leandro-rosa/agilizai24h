import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

import { auditFixture, gapsFixture } from "./fixtures";

const audit = jest.fn();
const gaps = jest.fn();
const hasPermission = jest.fn();

// The SWC Jest transform hoists `import` above jest.mock(): jest.doMock() plus a dynamic
// require() is the pattern this app already uses (see supply/drive-sync-button.spec.tsx).
jest.doMock("../../../lib/api/balance-audit", () => ({
  useGetBalanceAuditQuery: (...args: unknown[]) => audit(...args),
  useGetIngestionGapsQuery: (...args: unknown[]) => gaps(...args),
}));
jest.doMock("../../../lib/auth/use-permission", () => ({ useHasPermission: (...args: unknown[]) => hasPermission(...args) }));
jest.doMock("../../month-range-picker", () => ({ MonthRangePicker: () => <div data-testid="range-picker" /> }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BalanceQualityTab }: { BalanceQualityTab: ComponentType<{ storeName: (id: number) => string }> } = require("./balance-quality-tab");

const ok = (data: unknown) => ({ data, isLoading: false, isSuccess: true, isError: false, error: undefined, refetch: jest.fn() });

const renderTab = () => render(<BalanceQualityTab storeName={(id) => `Loja ${id}`} />);

describe("BalanceQualityTab", () => {
  beforeEach(() => {
    audit.mockReset();
    gaps.mockReset();
    hasPermission.mockReset();
    hasPermission.mockReturnValue(true);
    gaps.mockReturnValue(ok(gapsFixture));
  });

  it("shows a loading state while the audit loads", () => {
    audit.mockReturnValue({ data: undefined, isLoading: true, isSuccess: false, isError: false, error: undefined, refetch: jest.fn() });

    renderTab();

    expect(screen.getByRole("status", { name: "Carregando" })).toBeInTheDocument();
  });

  it("shows an empty state that explains no visit data exists — not an error and not zero differences", () => {
    audit.mockReturnValue(ok(auditFixture({ covered: { stores: 0, visits: 0, lines: 0, first_visit_end: null, last_visit_end: null } })));

    renderTab();

    expect(screen.getByText(/Ainda não há dados de visitas de abastecimento/)).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível carregar/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error state, with retry, when the audit request fails", () => {
    audit.mockReturnValue({ data: undefined, isLoading: false, isSuccess: false, isError: true, error: { status: 502, data: null }, refetch: jest.fn() });

    renderTab();

    expect(screen.getByText("Não foi possível carregar os dados")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("shows the forbidden state from the gateway's 403 without treating it as a generic error", () => {
    audit.mockReturnValue({ data: undefined, isLoading: false, isSuccess: false, isError: true, error: { status: 403, data: null }, refetch: jest.fn() });

    renderTab();

    expect(screen.getByText("Sem permissão")).toBeInTheDocument();
    expect(screen.queryByText("Não foi possível carregar os dados")).not.toBeInTheDocument();
  });

  it("shows forbidden and requests nothing when the session lacks inventory:read", () => {
    hasPermission.mockReturnValue(false);
    audit.mockReturnValue({ data: undefined, isLoading: false, isSuccess: false, isError: false, error: undefined, refetch: jest.fn() });

    renderTab();

    expect(screen.getByText("Sem permissão")).toBeInTheDocument();
    expect(audit).toHaveBeenCalledWith(expect.anything(), { skip: true });
    expect(gaps).toHaveBeenCalledWith(expect.anything(), { skip: true });
  });

  it("renders the audit when it has data", () => {
    audit.mockReturnValue(ok(auditFixture()));

    renderTab();

    expect(screen.getByText("Contagem × saldo do sistema")).toBeInTheDocument();
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});
