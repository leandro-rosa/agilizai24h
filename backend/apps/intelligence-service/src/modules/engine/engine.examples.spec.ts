import { runPair } from './engine'
import { inputFromReal } from './engine.testing'
import { REAL_PAIRS } from './real-pairs.fixture'

/**
 * The 12 real examples of docs/commercial-intelligence-v2-design.md, run through
 * the engine on the real January-August 2026 history (compact fixtures of the
 * operational counts; nothing is written anywhere). Baselines are the pricing-sheet
 * values. Expectations are the QUALITATIVE ones of the plan under the provisional
 * default parameters; where the engine differs from the plan's prose, the comment
 * says so — those differences are findings for the backtest, not bent to pass.
 */
const run = (key: string, baseline: number | null, over: Parameters<typeof inputFromReal>[1] = { baseline }) => runPair(inputFromReal(REAL_PAIRS[key], { ...over, baseline }))

describe('real examples', () => {
  it('1. healthy — Trident Menta x Ascenty ADM: keep the product, keep 21', () => {
    const r = run('trident_menta_adm', 21)

    expect(r.mix.value).toBe('keep')
    expect(r.quantity).toMatchObject({ action: 'keep', from: 21, to: 21, delta: 0 })
    expect(r.conflicts).toEqual([])
    expect(r.coverage).toBe('analysable_reliable_balance')
  })

  it('2. excess — Trident Morango x ADM: product kept, quantity reduced below 21', () => {
    const r = run('trident_morango_adm', 21)

    expect(r.mix.value).toBe('keep')
    expect(r.quantity.action).toBe('reduce')
    expect(r.quantity.to as number).toBeLessThan(21)
    // FINDING: the plan estimated ~7 to 10. The engine says 19 because H comes from this SKU's own restock
    // gaps (~49 days): an overstocked SKU is restocked rarely, so H inflates the band. See design D6.
    expect(r.quantity.intervalDays as number).toBeGreaterThan(30)
  })

  it('3. growth — Mentos Rainbow x ADM: no stock-out, so it never claims a shortage', () => {
    const r = run('mentos_rainbow_adm', 16)

    expect(r.quantity.action).not.toBe('increase')
    expect(r.quantity.action).not.toBe('reduce')
    // FINDING: the plan said "test a larger quantity" on the July/August doubling; with only two months of
    // rise and a baseline inside the demand band, the engine keeps. Only the backtest can say who is right.
    expect(r.quantity.action).toBe('keep')
  })

  it('4. low adherence — Cheetos x ADM: long exposure, low demand, recurring expiry → evaluate removal, never automatic', () => {
    const r = run('cheetos_adm', 5)

    expect(r.presence).toBe('low_adherence')
    expect(r.mix.value).toBe('evaluate_removal')
    expect(r.operation.map(a => a.code)).toContain('expiry_attention')
    expect(r.mix.networkRemovalPattern).toBe(false) // removal from the NETWORK needs far stronger evidence
  })

  it('5. recurring expiry with falling demand — Coca Zero x JDI01: product kept, quantity reduced, expiry attention', () => {
    const r = run('coca_zero_jdi01', 12)

    expect(r.mix.value).toBe('keep')
    expect(r.quantity.action).toBe('reduce')
    expect(r.operation.map(a => a.code)).toContain('expiry_attention')
  })

  it('6. good sales plus "other reason" — Coca lata x ADM: keep both, investigate losses, never call it theft', () => {
    const r = run('coca_lata_adm', 12)

    expect(r.mix.value).toBe('keep')
    expect(r.quantity.action).toBe('keep')
    expect(r.operation.map(a => a.code)).toContain('investigate_losses')
    expect(JSON.stringify(r)).not.toMatch(/theft|roubo|furto/i)
  })

  it('6b. losses are counted once in the economics: contribution = margin − cost of units lost', () => {
    const r = run('coca_lata_adm', 12)

    expect(r.economics.contributionCents).toBe((r.economics.marginCents as number) - (r.economics.lossCostCents as number))
  })

  it('7. never tested — Guaraná 2L x ADM is never tested, not "does not sell"; elsewhere in the network it sells', () => {
    const adm = run('guarana2l_adm', 6)
    const vin02 = run('guarana2l_vin02', 6)

    expect(adm).toMatchObject({ presence: 'never_tested', coverage: 'insufficient_history' })
    expect(adm.mix.value).toBe('insufficient_data')
    expect(adm.balance).toMatchObject({ releasesBalanceUse: false, gateReason: 'never_stocked' })
    expect(vin02.presence).toBe('sells')
  })

  it('8. good history without a recent restock — Suflair x ADM: kept, flagged as no recent restock, not penalised', () => {
    const r = run('suflair_adm', 20)

    expect(r.presence).toBe('no_recent_restock')
    expect(r.mix.value).toBe('keep')
  })

  it('9. reliable balance — Trident Menta x ADM: within tolerance, gate released, labelled an estimate', () => {
    const r = run('trident_menta_adm', 21)

    expect(r.balance).toMatchObject({ releasesBalanceUse: true, label: 'saldo estimado' })
    expect(r.balance.tolerance.status).toBe('within_tolerance')
    expect(r.confidence.balanceReliability.level).toBe('high')
  })

  it('10. unreliable balance — Cheetos x ADM has no recent count; Coca Zero x JDI01 shows a balance rise without event', () => {
    const cheetos = run('cheetos_adm', 5)
    const cocaZero = run('coca_zero_jdi01', 12)

    expect(cheetos.balance).toMatchObject({ releasesBalanceUse: false, label: 'saldo estimado — baixa confiabilidade' })
    expect(cheetos.balance.tolerance.reason).toBe('last_count_too_old')
    expect(cocaZero.coverage).toBe('conflicting_data')
    expect(cocaZero.balance.releasesBalanceUse).toBe(false)
  })

  it('11. ideal is not what to bring — the engine states the ideal for an interval and has no "bring" at all', () => {
    const r = run('trident_menta_adm', 21)

    expect(r.quantity.intervalDays).not.toBeNull()
    expect(Object.keys(r.quantity)).not.toContain('toBring')
  })

  it('12. zero at the next restock rests on a removal evaluation — Cheetos has it; the zero itself is Phase 4', () => {
    expect(run('cheetos_adm', 5).mix.value).toBe('evaluate_removal')
  })

  it('every example states the baseline of the time is unknown and carries a limitation list', () => {
    for (const key of Object.keys(REAL_PAIRS)) {
      const r = run(key, 12)

      expect(r.quantity.baselineIsOfRecord).toBe(true)
      expect(r.explanation.limitations.join(' ')).toMatch(/baseline of the time is unknown/)
    }
  })
})
