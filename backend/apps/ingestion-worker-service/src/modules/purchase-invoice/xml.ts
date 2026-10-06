/**
 * A small, non-validating XML reader — enough for an NF-e, and no new dependency. Elements become a tree; prefixes are dropped
 * (`nfe:det` reads as `det`); attributes, CDATA, comments, the XML declaration and the five predefined entities are handled.
 * It is not a general XML library: no DTDs, no namespaces beyond stripping the prefix.
 */
export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" }
const decode = (value: string) => value.replace(/&(lt|gt|amp|quot|apos);/g, m => ENTITIES[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
const local = (name: string) => name.slice(name.indexOf(':') + 1)

export class XmlError extends Error {}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g

  let match: RegExpExecArray | null
  while ((match = token.exec(source)) !== null) {
    const [whole, cdata, closing, opening, attrText, selfClosing, text] = match
    const top = stack[stack.length - 1]

    if (cdata !== undefined) top.text += cdata
    else if (closing !== undefined) {
      if (stack.length === 1 || top.name !== local(closing)) throw new XmlError(`Unexpected closing tag </${closing}>`)
      stack.pop()
    } else if (opening !== undefined) {
      const node: XmlNode = { name: local(opening), attrs: {}, children: [], text: '' }
      for (const attr of (attrText ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[local(attr[1])] = decode(attr[2] ?? attr[3] ?? '')
      top.children.push(node)
      if (selfClosing !== '/') stack.push(node)
    } else if (text !== undefined && !whole.startsWith('<')) top.text += decode(text)
  }

  if (stack.length !== 1) throw new XmlError(`Unclosed tag <${stack[stack.length - 1].name}>`)

  return root
}

/** The first descendant (depth-first) with this name, or undefined. */
export function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (child.name === name) return child
    const deeper = find(child, name)
    if (deeper) return deeper
  }

  return undefined
}

export const childText = (node: XmlNode | undefined, name: string): string | undefined => node?.children.find(c => c.name === name)?.text.trim() || undefined
export const childrenNamed = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter(c => c.name === name) ?? []
