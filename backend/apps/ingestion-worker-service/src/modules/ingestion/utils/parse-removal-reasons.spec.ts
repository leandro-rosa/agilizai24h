import { normalizeReasonText, parseRemovalReasons } from './parse-removal-reasons'

describe('parseRemovalReasons', () => {
  describe('the defining case', () => {
    it('splits a mixed-reason field into per-reason quantities', () => {
      // "-6 Devolução, -3 Outro motivo" is nine units off the shelf but only
      // three of them a loss. This split is why supply-service never has to
      // interpret text, and why the 9 never exists as a quantity.
      const result = parseRemovalReasons('-6 Devolução, -3 Outro motivo')

      expect(result).toEqual({
        ok: true,
        total: 9,
        quantities: [
          { reasonKey: 'return', quantity: 6 },
          { reasonKey: 'other_reason', quantity: 3 },
        ],
      })
    })

    it('never produces a single combined quantity', () => {
      const result = parseRemovalReasons('-6 Devolução, -3 Outro motivo')

      expect(result.ok && result.quantities.some(q => q.quantity === 9)).toBe(false)
    })
  })

  describe('single reason', () => {
    it('reads one reason', () => {
      expect(parseRemovalReasons('-4 Validade vencida')).toEqual({
        ok: true,
        total: 4,
        quantities: [{ reasonKey: 'expired', quantity: 4 }],
      })
    })

    it('reads a quantity written without the minus sign', () => {
      expect(parseRemovalReasons('4 Validade vencida')).toMatchObject({ ok: true, total: 4 })
    })
  })

  describe('every known reason', () => {
    it.each([
      ['Validade vencida', 'expired'],
      ['Produto danificado', 'damaged_product'],
      ['Outro motivo', 'other_reason'],
      ['Devolução', 'return'],
      ['Transferência', 'transfer'],
      ['Uso e consumo', 'internal_use'],
    ])('maps %s to %s', (label, key) => {
      const result = parseRemovalReasons(`-1 ${label}`)

      expect(result.ok && result.quantities[0].reasonKey).toBe(key)
    })
  })

  describe('text tolerance', () => {
    it('ignores case, accents and extra whitespace', () => {
      const result = parseRemovalReasons('-2   VALIDADE  VENCIDA')

      expect(result).toMatchObject({ ok: true, quantities: [{ reasonKey: 'expired', quantity: 2 }] })
    })

    it('accepts semicolons as separators', () => {
      const result = parseRemovalReasons('-1 Devolução; -2 Transferência')

      expect(result.ok && result.quantities).toHaveLength(2)
    })

    it('merges repeated reasons rather than emitting duplicate rows', () => {
      // The sink's grain is one row per (store, period, SKU, reason), so two
      // segments naming the same reason must combine.
      const result = parseRemovalReasons('-2 Outro motivo, -3 Outro motivo')

      expect(result).toMatchObject({ ok: true, total: 5, quantities: [{ reasonKey: 'other_reason', quantity: 5 }] })
    })
  })

  describe('empty field', () => {
    it.each([null, undefined, '', '   '])('treats %p as no removals, not as a failure', value => {
      // The row may be a pure restock; failing it would reject valid data.
      expect(parseRemovalReasons(value as string)).toEqual({ ok: true, quantities: [], total: 0 })
    })
  })

  describe('failures are reported, never guessed', () => {
    it('rejects an unknown reason instead of bucketing it', () => {
      const result = parseRemovalReasons('-3 Roubo')

      expect(result).toMatchObject({ ok: false, reason: 'unknown_reason' })
      expect(result.ok === false && result.detail).toMatch(/Roubo/)
    })

    it('rejects a segment it cannot read', () => {
      expect(parseRemovalReasons('vencidos varios')).toMatchObject({ ok: false, reason: 'unparseable' })
    })

    it('rejects a split that does not add up to the reported total', () => {
      // Silently adjusting either side would make the stored quantities
      // disagree with the file they came from.
      const result = parseRemovalReasons('-6 Devolução, -3 Outro motivo', 10)

      expect(result).toMatchObject({ ok: false, reason: 'total_mismatch' })
      expect(result.ok === false && result.detail).toMatch(/9.*10/)
    })

    it('accepts a split that matches the reported total', () => {
      expect(parseRemovalReasons('-6 Devolução, -3 Outro motivo', 9)).toMatchObject({ ok: true, total: 9 })
    })

    it('accepts a reported total written as a negative', () => {
      expect(parseRemovalReasons('-6 Devolução, -3 Outro motivo', -9)).toMatchObject({ ok: true })
    })
  })
})

describe('normalizeReasonText', () => {
  it('folds case, accents and whitespace', () => {
    expect(normalizeReasonText('  DEVOLUÇÃO  ')).toBe('devolucao')
    expect(normalizeReasonText('Transferência')).toBe('transferencia')
  })
})
