import { describe, it, expect } from "@jest/globals";
import { computePriority, type PriorityInput } from "./priority";
import { DEFAULT_PARAMETERS } from "./parameters";
import type { LossAction } from "./types";

const CRITICAL_VALUE_CENTS = DEFAULT_PARAMETERS.priority.criticalValueCents; // 30000

function baseInput(overrides: Partial<PriorityInput> = {}): PriorityInput {
  return {
    acaoPrioritaria: "investigar",
    confianca: "media",
    sinaisTransversais: [],
    valueLostCentsPrioritario: 0,
    firstSeenRecently: false,
    parameters: DEFAULT_PARAMETERS,
    ...overrides,
  };
}

describe("computePriority", () => {
  describe("dados_insuficientes — unconditional null", () => {
    it("returns null regardless of every other input, even when every other field looks maximally 'critica'", () => {
      // Every other field is set to the most critical-looking value possible: confidence alta,
      // a non-empty transversal-signals list, a huge value far above the threshold, and
      // firstSeenRecently=false (so the recent-history cap can't be mistaken for the reason).
      // If the dados_insuficientes check were merely one of several ANDed conditions instead of
      // an unconditional, first-checked early return, this combination would slip through to
      // "critica". It must still be null.
      const input = baseInput({
        acaoPrioritaria: "dados_insuficientes",
        confianca: "alta",
        sinaisTransversais: ["concentração local", "problema sistêmico"],
        valueLostCentsPrioritario: 999_999_999,
        firstSeenRecently: false,
      });
      expect(computePriority(input)).toBeNull();
    });

    it("still returns null with firstSeenRecently=true too (the cap never matters once action is dados_insuficientes)", () => {
      const input = baseInput({
        acaoPrioritaria: "dados_insuficientes",
        confianca: "alta",
        sinaisTransversais: ["sinal"],
        valueLostCentsPrioritario: 1_000_000,
        firstSeenRecently: true,
      });
      expect(computePriority(input)).toBeNull();
    });
  });

  describe("critica — requires CRITICAL_ACTIONS AND confidence >= media AND (sinais transversais OR value above threshold)", () => {
    it("suspender_abastecimento + confiança alta + sinaisTransversais não-vazio → critica", () => {
      const input = baseInput({
        acaoPrioritaria: "suspender_abastecimento",
        confianca: "alta",
        sinaisTransversais: ["concentração local"],
        valueLostCentsPrioritario: 100, // irrelevant: signals alone satisfy the OR branch
      });
      expect(computePriority(input)).toBe("critica");
    });

    it("confidence is a genuine gate: suspender_abastecimento + confiança baixa does NOT reach critica even with BOTH transversal signals present AND value above the critical threshold", () => {
      // Both disjuncts of the OR are satisfied (signals present AND value above threshold), so
      // if confidence were decorative rather than a real AND-gate, this would wrongly produce
      // "critica". suspender_abastecimento is also in HIGH_ACTIONS, so the correct fallback is
      // "alta", not some lower tier — that's the proof the gate blocked specifically the critica
      // branch and nothing else.
      const input = baseInput({
        acaoPrioritaria: "suspender_abastecimento",
        confianca: "baixa",
        sinaisTransversais: ["concentração local"],
        valueLostCentsPrioritario: CRITICAL_VALUE_CENTS + 50_000,
      });
      expect(computePriority(input)).toBe("alta");
    });

    it("avaliar_retirada_rede + no sinaisTransversais + value strictly above criticalValueCents + confiança media → critica", () => {
      const input = baseInput({
        acaoPrioritaria: "avaliar_retirada_rede",
        confianca: "media",
        sinaisTransversais: [],
        valueLostCentsPrioritario: CRITICAL_VALUE_CENTS + 1,
      });
      expect(computePriority(input)).toBe("critica");
    });

    it("same case with value BELOW the threshold and no signals → alta, not critica", () => {
      const input = baseInput({
        acaoPrioritaria: "avaliar_retirada_rede",
        confianca: "alta",
        sinaisTransversais: [],
        valueLostCentsPrioritario: CRITICAL_VALUE_CENTS - 1,
      });
      expect(computePriority(input)).toBe("alta");
    });

    it("boundary: value exactly AT criticalValueCents (not above), no signals → does NOT reach critica (code uses strict '>')", () => {
      // The production code is `valueLostCentsPrioritario > input.parameters.priority.criticalValueCents`
      // — a strict greater-than. The exact boundary value must therefore fall on the "alta" side,
      // not "critica". A test using threshold+1 or threshold-1 would not catch a `>` vs `>=` bug
      // at the boundary itself; this uses the threshold value exactly.
      const input = baseInput({
        acaoPrioritaria: "avaliar_retirada_rede",
        confianca: "alta",
        sinaisTransversais: [],
        valueLostCentsPrioritario: CRITICAL_VALUE_CENTS,
      });
      expect(computePriority(input)).toBe("alta");
    });

    it("reduzir_abastecimento NEVER reaches critica, even with confiança alta and sinaisTransversais present (it is outside CRITICAL_ACTIONS) — but does reach alta", () => {
      const input = baseInput({
        acaoPrioritaria: "reduzir_abastecimento",
        confianca: "alta",
        sinaisTransversais: ["concentração local", "problema sistêmico"],
        valueLostCentsPrioritario: 999_999_999,
      });
      expect(computePriority(input)).toBe("alta");
    });
  });

  describe("alta / media / baixa tiers", () => {
    const highActionsBesidesSuspender: LossAction[] = [
      "avaliar_retirada_loja",
      "avaliar_permanencia_loja",
      "avaliar_permanencia_rede",
    ];

    it.each(highActionsBesidesSuspender)("%s (not eligible for critica in this fixture) → alta", (acao) => {
      const input = baseInput({
        acaoPrioritaria: acao,
        confianca: "baixa", // below média — even avaliar_retirada_rede/avaliar_permanencia_rede couldn't reach critica here
        sinaisTransversais: [],
        valueLostCentsPrioritario: 0,
      });
      expect(computePriority(input)).toBe("alta");
    });

    it("investigar → media", () => {
      const input = baseInput({ acaoPrioritaria: "investigar" });
      expect(computePriority(input)).toBe("media");
    });

    it("manter_monitorar → media", () => {
      const input = baseInput({ acaoPrioritaria: "manter_monitorar" });
      expect(computePriority(input)).toBe("media");
    });

    it("manter → baixa", () => {
      const input = baseInput({ acaoPrioritaria: "manter" });
      expect(computePriority(input)).toBe("baixa");
    });
  });

  describe("teto de histórico recente (firstSeenRecently) — 'só Média no máximo', literal", () => {
    it("a case that would be critica caps to media (not alta, not baixa) when firstSeenRecently=true", () => {
      // Without the cap, this exact fixture (avaliar_retirada_rede, confiança alta, signals
      // present) would be "critica" — confirmed by the equivalent case above with
      // firstSeenRecently=false. With firstSeenRecently=true, the cap must land on "media"
      // specifically, not stop halfway at "alta".
      const input = baseInput({
        acaoPrioritaria: "avaliar_retirada_rede",
        confianca: "alta",
        sinaisTransversais: ["concentração local"],
        valueLostCentsPrioritario: 0,
        firstSeenRecently: true,
      });
      expect(computePriority(input)).toBe("media");
    });

    it("a case that would be alta caps to media when firstSeenRecently=true", () => {
      // reduzir_abastecimento is never eligible for critica (outside CRITICAL_ACTIONS), so its
      // uncapped tier is "alta" — confirmed by the equivalent case above with
      // firstSeenRecently=false. With the cap applied, it must land on "media".
      const input = baseInput({
        acaoPrioritaria: "reduzir_abastecimento",
        confianca: "alta",
        sinaisTransversais: ["concentração local"],
        valueLostCentsPrioritario: 999_999_999,
        firstSeenRecently: true,
      });
      expect(computePriority(input)).toBe("media");
    });

    it("a media-tier case with firstSeenRecently=true stays media, unchanged — the cap only ever lowers, never raises", () => {
      const input = baseInput({
        acaoPrioritaria: "investigar",
        firstSeenRecently: true,
      });
      expect(computePriority(input)).toBe("media");
    });

    it("a baixa-tier case with firstSeenRecently=true stays baixa — the cap does not touch tiers already at or below media", () => {
      const input = baseInput({
        acaoPrioritaria: "manter",
        firstSeenRecently: true,
      });
      expect(computePriority(input)).toBe("baixa");
    });
  });

  describe("priority and confidence are independent dimensions", () => {
    it("acaoPrioritaria='suspender_abastecimento' + confianca='baixa' is accepted without error and legitimately produces 'alta' (not 'critica', not a crash)", () => {
      // This exact pairing was flagged in the original design conversation: confidence being too
      // low to reach critica must not prevent the function from producing a valid, non-null
      // priority for a high-severity action. It must not throw, must not return null, and must
      // not silently fall through to something lower than the action's real severity tier.
      const input = baseInput({
        acaoPrioritaria: "suspender_abastecimento",
        confianca: "baixa",
        sinaisTransversais: [],
        valueLostCentsPrioritario: 0,
        firstSeenRecently: false,
      });
      expect(() => computePriority(input)).not.toThrow();
      const result = computePriority(input);
      expect(result).not.toBeNull();
      expect(result).not.toBe("critica");
      expect(result).toBe("alta");
    });
  });
});
