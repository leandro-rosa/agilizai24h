import { NotAnNfeError, parseNfe } from './nfe.parser'
import { parseXml } from './xml'

const nfe = (items: string, ide = '<nNF>1234</nNF><serie>1</serie><dhEmi>2026-10-05T09:30:00-03:00</dhEmi>', emit = '<CNPJ>35370333000100</CNPJ><xNome>Quinoa Indústria de Alimentos Ltda</xNome>') => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe43261035370333000100550010000012341000012345" versao="4.00">
    <ide>${ide}</ide>
    <emit>${emit}</emit>
    ${items}
  </infNFe></NFe>
</nfeProc>`

const det = (n: number, prod: string) => `<det nItem="${n}"><prod>${prod}</prod></det>`
const prod = (over: Record<string, string> = {}) => {
  const f = { cProd: 'QW-01', cEAN: '7891234567895', xProd: 'Wrap de quinoa &amp; frango', uCom: 'UN', qCom: '100.0000', vUnCom: '8.0000000000', vProd: '800.00', ...over }

  return Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join('')
}

describe('parseNfe', () => {
  it('reads issuer, number, date, key and items from an nfeProc', () => {
    const invoice = parseNfe(nfe(det(1, prod()) + det(2, prod({ cProd: 'QW-02', cEAN: 'SEM GTIN', xProd: 'Barra', qCom: '24.0000', vUnCom: '3.5500', vProd: '85.20' }))))

    expect(invoice).toMatchObject({ key: '43261035370333000100550010000012341000012345', number: '1234', series: '1', issuedOn: '2026-10-05', issuer: { taxId: '35370333000100', name: 'Quinoa Indústria de Alimentos Ltda' } })
    expect(invoice.items).toHaveLength(2)
    expect(invoice.items[0]).toMatchObject({ line: 1, code: 'QW-01', ean: '7891234567895', description: 'Wrap de quinoa & frango', unit: 'UN', quantity: 100, quantityIsWhole: true, unitCostCents: 800, totalCents: 80000 })
    expect(invoice.items[1]).toMatchObject({ ean: null, quantity: 24, unitCostCents: 355, totalCents: 8520 })
  })

  it('keeps the date as written, with no timezone shift near midnight', () => {
    expect(parseNfe(nfe(det(1, prod()), '<nNF>9</nNF><dhEmi>2026-10-31T23:50:00-03:00</dhEmi>')).issuedOn).toBe('2026-10-31')
  })

  it('flags a fractional quantity instead of rounding it', () => {
    const item = parseNfe(nfe(det(1, prod({ qCom: '2.5000', vUnCom: '10.00', vProd: '25.00' })))).items[0]

    expect(item).toMatchObject({ quantity: 2.5, quantityIsWhole: false })
  })

  it('reads a bare NFe, CPF issuers and prefixed tags', () => {
    const bare = `<ns:NFe xmlns:ns="http://www.portalfiscal.inf.br/nfe"><ns:infNFe Id="NFe1"><ns:ide><ns:nNF>7</ns:nNF><ns:dEmi>2026-10-02</ns:dEmi></ns:ide><ns:emit><ns:CPF>123.456.789-09</ns:CPF><ns:xNome>Isa</ns:xNome></ns:emit><ns:det nItem="1"><ns:prod><ns:cProd>1</ns:cProd><ns:xProd>P</ns:xProd><ns:qCom>1</ns:qCom><ns:vUnCom>2.00</ns:vUnCom><ns:vProd>2.00</ns:vProd></ns:prod></ns:det></ns:infNFe></ns:NFe>`
    const invoice = parseNfe(bare)

    expect(invoice).toMatchObject({ number: '7', issuedOn: '2026-10-02', issuer: { taxId: '12345678909', name: 'Isa' } })
  })

  it('rejects what is not an NF-e, or lacks what a purchase needs, instead of guessing', () => {
    expect(() => parseNfe('<root><a/></root>')).toThrow(NotAnNfeError)
    expect(() => parseNfe('not xml at all <')).toThrow(NotAnNfeError)
    expect(() => parseNfe(nfe(det(1, prod()), '<dhEmi>2026-10-05</dhEmi>'))).toThrow(/nNF/)
    expect(() => parseNfe(nfe(det(1, prod()), undefined, '<xNome>Sem CNPJ</xNome>'))).toThrow(/tax id/)
    expect(() => parseNfe(nfe(det(1, prod({ vUnCom: 'abc' }))))).toThrow(/unit cost/)
    expect(() => parseNfe(nfe(det(1, prod({ qCom: '0' }))))).toThrow(/quantity/)
    expect(() => parseNfe(nfe(''))).toThrow(/no items/)
  })
})

describe('parseXml', () => {
  it('handles CDATA, comments, entities, attributes and self-closing tags', () => {
    const root = parseXml(`<?xml version="1.0"?><!-- c --><a x='1' y="2"><b><![CDATA[<raw>]]></b><c/><d>&lt;ok&gt; &amp; &#65;</d></a>`)
    const a = root.children[0]

    expect(a.attrs).toEqual({ x: '1', y: '2' })
    expect(a.children.map(c => c.name)).toEqual(['b', 'c', 'd'])
    expect(a.children[0].text).toBe('<raw>')
    expect(a.children[2].text).toBe('<ok> & A')
  })

  it('rejects mismatched or unclosed tags', () => {
    expect(() => parseXml('<a><b></a>')).toThrow()
    expect(() => parseXml('<a><b>')).toThrow()
  })
})
