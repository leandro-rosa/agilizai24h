import { describe, it, expect } from "@jest/globals";
import { severityRank, clampSeverity, mostSevere } from "./severity";
import { ACTION_SEVERITY_ORDER, type LossAction } from "./types";

describe("severityRank", () => {
  it("assigns a full, strict, gap-free ranking (0..9) across all 10 LossAction values, matching ACTION_SEVERITY_ORDER exactly", () => {
    // Every action's rank must equal its own index in the canonical order — checked for
    // all 10 values, not spot-checked.
    ACTION_SEVERITY_ORDER.forEach((action, index) => {
      expect(severityRank(action)).toBe(index);
    });

    // And the resulting set of ranks has no duplicates and no gaps: sorted, it is exactly
    // [0, 1, ..., 9]. This would catch a bug where two actions shared a rank (duplicate
    // index) or a rank was skipped, even if that particular pair wasn't hand-picked above.
    const ranks = ACTION_SEVERITY_ORDER.map((action) => severityRank(action));
    expect([...ranks].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("orders 'avaliar_retirada_rede' (most severe) strictly ahead of 'dados_insuficientes' (least severe)", () => {
    expect(severityRank("avaliar_retirada_rede")).toBeLessThan(severityRank("dados_insuficientes"));
  });
});

describe("clampSeverity", () => {
  it("clamps DOWN to the ceiling when action is more severe than the ceiling", () => {
    // avaliar_retirada_rede (rank 0, most severe) vs reduzir_abastecimento (rank 5): the
    // action is more severe (lower rank) than the ceiling, so the clamp must trigger and
    // the ceiling wins.
    expect(clampSeverity("avaliar_retirada_rede", "reduzir_abastecimento")).toBe("reduzir_abastecimento");
  });

  it("does NOT clamp when action is already milder than the ceiling — returns action unchanged", () => {
    // manter (rank 8) vs reduzir_abastecimento (rank 5): the action is already milder
    // (higher rank = less severe) than the ceiling, so clamping must not fire — the
    // action passes through unchanged. A test that only checked the "clamp triggers"
    // direction above would not catch an inverted comparison (`>` instead of `<`) here;
    // an inverted comparison would wrongly downgrade "manter" to "reduzir_abastecimento".
    expect(clampSeverity("manter", "reduzir_abastecimento")).toBe("manter");
  });

  it("boundary: does NOT clamp when action equals the ceiling exactly — returns action unchanged", () => {
    // Equal severity (rank 6 === rank 6): `severityRank(action) < severityRank(ceiling)` is
    // false when the two are equal, so the clamp must not fire. This is the strict-
    // inequality boundary — a `<=` bug here would wrongly overwrite "investigar" with
    // itself via the ceiling branch instead of the action branch (unobservable by value,
    // but this pins the intended branch behavior for the equal case explicitly).
    expect(clampSeverity("investigar", "investigar")).toBe("investigar");
  });

  it("never raises the ceiling: a mild action stays mild even against a far more severe ceiling", () => {
    // dados_insuficientes (rank 9, least severe action) vs avaliar_retirada_rede (rank 0,
    // most severe ceiling): action is far milder than the ceiling, so it must pass through
    // unchanged rather than being "promoted" toward the ceiling's severity.
    expect(clampSeverity("dados_insuficientes", "avaliar_retirada_rede")).toBe("dados_insuficientes");
  });
});

describe("mostSevere", () => {
  it("returns the most severe action from a list where it sits in the middle — not the first or last element", () => {
    // Input order: manter (rank 8), avaliar_retirada_loja (rank 2), dados_insuficientes
    // (rank 9). Hand trace: sorted ascending by rank → [avaliar_retirada_loja(2),
    // manter(8), dados_insuficientes(9)] → first element is avaliar_retirada_loja.
    // That is neither list[0] ("manter") nor list[list.length - 1]
    // ("dados_insuficientes") — proves mostSevere actually compares severity rather than
    // just returning an array endpoint.
    const actions: LossAction[] = ["manter", "avaliar_retirada_loja", "dados_insuficientes"];
    expect(mostSevere(actions)).toBe("avaliar_retirada_loja");
  });

  it("does not mutate the input array", () => {
    const actions: LossAction[] = ["manter", "avaliar_retirada_loja", "dados_insuficientes"];
    const copy = [...actions];
    mostSevere(actions);
    expect(actions).toEqual(copy);
  });

  it("returns the sole element for a single-item list", () => {
    expect(mostSevere(["reduzir_abastecimento"])).toBe("reduzir_abastecimento");
  });

  it("returns the most severe among all 10 actions when input is given in reverse-severity order", () => {
    // Input is the exact reverse of ACTION_SEVERITY_ORDER, so the most severe action
    // ("avaliar_retirada_rede") is the LAST element in input order here — combined with
    // the middle-element test above, this rules out both list[0] and list[list.length-1]
    // as accidental implementations.
    const reversed = [...ACTION_SEVERITY_ORDER].reverse();
    expect(mostSevere(reversed)).toBe("avaliar_retirada_rede");
  });
});
