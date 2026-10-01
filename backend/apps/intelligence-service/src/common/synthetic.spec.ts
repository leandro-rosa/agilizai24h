import { isSynthetic } from './synthetic'

describe('isSynthetic', () => {
  it.each(['Loja [TESTE]', 'Produto SINTÉTICO', 'synthetic store', 'dado sintetico'])('flags %p', name => expect(isSynthetic(name)).toBe(true))
  it.each(['Ascenty - ADM', 'Trident Menta', '', null, undefined])('does not flag %p', name => expect(isSynthetic(name)).toBe(false))
})
