import { childText, childrenNamed, find, parseXml, XmlError } from './xml'

export interface ParsedInvoiceItem {
  line: number
  /** Supplier's own product code (`cProd`). */
  code: string
  /** Barcode, or null when the invoice says "SEM GTIN" or leaves it blank. */
  ean: string | null
  description: string
  unit: string | null
  /** Units as invoiced. Fractional quantities (kg) are kept as given and flagged, never rounded. */
  quantity: number
  quantityIsWhole: boolean
  unitCostCents: number
  totalCents: number
}

export interface ParsedInvoice {
  /** 44-digit access key, when present. */
  key: string | null
  number: string
  series: string | null
  /** `YYYY-MM-DD` as written on the invoice (no timezone shift). */
  issuedOn: string
  issuer: { taxId: string; name: string }
  items: ParsedInvoiceItem[]
}

export class NotAnNfeError extends Error {}

const onlyDigits = (value: string | undefined) => (value ?? '').replace(/\D/g, '')
/** `8.0000000000` → 800 cents, rounding half up on the real value. */
const toCents = (value: string | undefined): number | null => {
  if (value === undefined || !/^-?\d+(\.\d+)?$/.test(value.trim())) return null

  return Math.round(Number(value.trim()) * 100)
}

/**
 * Reads an NF-e XML (a bare `NFe` or an `nfeProc` wrapper) into the fields purchasing needs. It does not guess: a value that
 * cannot be read throws, so a malformed file is rejected whole instead of recording a wrong purchase.
 */
export function parseNfe(xml: string): ParsedInvoice {
  let document
  try {
    document = parseXml(xml)
  } catch (error) {
    if (error instanceof XmlError) throw new NotAnNfeError(`Not a readable XML: ${error.message}`)
    throw error
  }

  const inf = find(document, 'infNFe')
  if (!inf) throw new NotAnNfeError('Not an NF-e: no infNFe element')

  const ide = find(inf, 'ide')
  const emit = find(inf, 'emit')
  const number = childText(ide, 'nNF')
  const issued = childText(ide, 'dhEmi') ?? childText(ide, 'dEmi')
  const taxId = onlyDigits(childText(emit, 'CNPJ') ?? childText(emit, 'CPF'))
  const name = childText(emit, 'xNome')

  if (!number) throw new NotAnNfeError('Invoice number (nNF) is missing')
  if (!issued || !/^\d{4}-\d{2}-\d{2}/.test(issued)) throw new NotAnNfeError('Issue date (dhEmi) is missing or unreadable')
  if (!taxId || !name) throw new NotAnNfeError('Issuer tax id or name is missing')

  const items = childrenNamed(inf, 'det').map((det, index): ParsedInvoiceItem => {
    const prod = find(det, 'prod')
    const quantity = Number(childText(prod, 'qCom'))
    const unitCost = toCents(childText(prod, 'vUnCom'))
    const total = toCents(childText(prod, 'vProd'))
    const line = Number(det.attrs.nItem ?? index + 1)

    if (!prod || !Number.isFinite(quantity) || quantity <= 0) throw new NotAnNfeError(`Item ${line}: quantity (qCom) is missing or unreadable`)
    if (unitCost === null || total === null) throw new NotAnNfeError(`Item ${line}: unit cost (vUnCom) or total (vProd) is missing or unreadable`)

    const ean = childText(prod, 'cEAN') ?? childText(prod, 'cEANTrib')

    return {
      line,
      code: childText(prod, 'cProd') ?? '',
      ean: ean && /^\d{8,14}$/.test(ean) ? ean : null,
      description: childText(prod, 'xProd') ?? '',
      unit: childText(prod, 'uCom') ?? null,
      quantity,
      quantityIsWhole: Number.isInteger(quantity),
      unitCostCents: unitCost,
      totalCents: total,
    }
  })
  if (items.length === 0) throw new NotAnNfeError('The invoice has no items (det)')

  return {
    key: inf.attrs.Id?.replace(/^NFe/, '') || null,
    number,
    series: childText(ide, 'serie') ?? null,
    issuedOn: issued.slice(0, 10),
    issuer: { taxId, name },
    items,
  }
}
