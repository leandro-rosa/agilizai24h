import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { classifyName, type Classification, type TaxonomyCategory } from '../utils/classify'
import { normalizeName } from '../utils/normalize-name'

const MAX_KEYWORDS = 40
const MAX_NAME = 80

export interface SubcategoryView {
  id: number
  category_id: number
  name: string
  keywords: string[]
  status: string
  products: number
}

export interface CategoryView {
  id: number
  key: string
  name: string
  keywords: string[]
  status: string
  /** Products that carry this category (any status of product). */
  products: number
  subcategories: SubcategoryView[]
}

export interface ReviewItem {
  sku: string
  name: string
  current: { category: string; subcategory: string | null; confirmed: boolean }
  proposed: { category: string; categoryName: string; subcategory: string | null }
  matched: string[]
}

const clean = (value: unknown, label: string): string => {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!text) throw new BadRequestException(`${label} é obrigatório`)
  if (text.length > MAX_NAME) throw new BadRequestException(`${label} é longo demais (máximo ${MAX_NAME} caracteres)`)

  return text
}

/** Keywords as the operator typed them, trimmed and without repeats (case/accent-insensitive). */
export function cleanKeywords(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new BadRequestException('keywords deve ser uma lista de palavras')
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value) {
    const word = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
    const folded = normalizeName(word)
    if (!word || seen.has(folded)) continue
    if (word.length > 60) throw new BadRequestException(`Palavra-chave longa demais: "${word.slice(0, 20)}…"`)
    seen.add(folded)
    out.push(word)
  }
  if (out.length > MAX_KEYWORDS) throw new BadRequestException(`No máximo ${MAX_KEYWORDS} palavras-chave`)

  return out
}

/** Slug key of a new category: folded, dashes, unique among the existing keys. */
export function keyFor(name: string, taken: Set<string>): string {
  const base = normalizeName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'categoria'
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`

  return key
}

/**
 * The managed classification: categories and subcategories that every flow (forms, filters, import, invoices, pricing) reads from. It never deletes:
 * a used category or subcategory is inactivated, which stops offering it for new products and leaves the products that have it untouched.
 */
@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaClientService) {}

  async list(): Promise<CategoryView[]> {
    const [categories, byCategory, bySub] = await Promise.all([
      this.prisma.category.findMany({ include: { subcategories: { orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } }),
      this.prisma.product.groupBy({ by: ['category'], _count: { _all: true } }),
      this.prisma.product.groupBy({ by: ['category', 'subcategory'], _count: { _all: true }, where: { subcategory: { not: null } } }),
    ])
    const count = new Map(byCategory.map(row => [row.category, row._count._all]))
    const subCount = new Map(bySub.map(row => [`${row.category}|${normalizeName(row.subcategory ?? '')}`, row._count._all]))

    return categories.map(category => ({
      id: category.id,
      key: category.key,
      name: category.name,
      keywords: category.keywords,
      status: category.status,
      products: count.get(category.key) ?? 0,
      subcategories: category.subcategories.map(sub => ({ id: sub.id, category_id: sub.category_id, name: sub.name, keywords: sub.keywords, status: sub.status, products: subCount.get(`${category.key}|${normalizeName(sub.name)}`) ?? 0 })),
    }))
  }

  async createCategory(input: { name?: unknown; keywords?: unknown }): Promise<CategoryView> {
    const name = clean(input.name, 'O nome da categoria')
    const existing = await this.prisma.category.findMany({ select: { key: true, name: true } })
    if (existing.some(row => normalizeName(row.name) === normalizeName(name))) throw new ConflictException(`Já existe a categoria "${name}"`)
    const created = await this.prisma.category.create({ data: { key: keyFor(name, new Set(existing.map(row => row.key))), name, keywords: cleanKeywords(input.keywords) } })

    return (await this.list()).find(category => category.id === created.id) as CategoryView
  }

  async updateCategory(id: number, input: { name?: unknown; keywords?: unknown; status?: unknown }): Promise<CategoryView> {
    const current = await this.prisma.category.findUnique({ where: { id } })
    if (!current) throw new NotFoundException(`Categoria ${id} não encontrada`)
    const data: { name?: string; keywords?: string[]; status?: string } = {}
    if (input.name !== undefined) {
      const name = clean(input.name, 'O nome da categoria')
      const clash = (await this.prisma.category.findMany({ where: { id: { not: id } }, select: { name: true } })).some(row => normalizeName(row.name) === normalizeName(name))
      if (clash) throw new ConflictException(`Já existe a categoria "${name}"`)
      data.name = name
    }
    if (input.keywords !== undefined) data.keywords = cleanKeywords(input.keywords)
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'inactive') throw new BadRequestException('status deve ser active ou inactive')
      data.status = input.status
    }
    await this.prisma.category.update({ where: { id }, data })

    return (await this.list()).find(category => category.id === id) as CategoryView
  }

  async createSubcategory(categoryId: number, input: { name?: unknown; keywords?: unknown }): Promise<CategoryView> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, include: { subcategories: true } })
    if (!category) throw new NotFoundException(`Categoria ${categoryId} não encontrada`)
    if (category.status !== 'active') throw new ConflictException('Esta categoria está inativa: reative-a antes de criar subcategorias nela')
    const name = clean(input.name, 'O nome da subcategoria')
    if (category.subcategories.some(sub => normalizeName(sub.name) === normalizeName(name))) throw new ConflictException(`A categoria ${category.name} já tem a subcategoria "${name}"`)
    await this.prisma.subcategory.create({ data: { category_id: categoryId, name, keywords: cleanKeywords(input.keywords) } })

    return (await this.list()).find(row => row.id === categoryId) as CategoryView
  }

  /** Renaming also renames the text on the products that carry it (one transaction); moving to another category is not offered. */
  async updateSubcategory(id: number, input: { name?: unknown; keywords?: unknown; status?: unknown }): Promise<CategoryView> {
    const current = await this.prisma.subcategory.findUnique({ where: { id }, include: { category: { include: { subcategories: true } } } })
    if (!current) throw new NotFoundException(`Subcategoria ${id} não encontrada`)
    const data: { name?: string; keywords?: string[]; status?: string } = {}
    let renameTo: string | null = null
    if (input.name !== undefined) {
      const name = clean(input.name, 'O nome da subcategoria')
      if (current.category.subcategories.some(sub => sub.id !== id && normalizeName(sub.name) === normalizeName(name))) throw new ConflictException(`A categoria ${current.category.name} já tem a subcategoria "${name}"`)
      data.name = name
      if (name !== current.name) renameTo = name
    }
    if (input.keywords !== undefined) data.keywords = cleanKeywords(input.keywords)
    if (input.status !== undefined) {
      if (input.status !== 'active' && input.status !== 'inactive') throw new BadRequestException('status deve ser active ou inactive')
      data.status = input.status
    }

    await this.prisma.$transaction(async tx => {
      await tx.subcategory.update({ where: { id }, data })
      if (renameTo !== null) {
        const products = await tx.product.findMany({ where: { category: current.category.key, subcategory: { not: null } }, select: { id: true, subcategory: true } })
        const ids = products.filter(p => normalizeName(p.subcategory ?? '') === normalizeName(current.name)).map(p => p.id)
        if (ids.length > 0) await tx.product.updateMany({ where: { id: { in: ids } }, data: { subcategory: renameTo } })
      }
    })

    return (await this.list()).find(row => row.id === current.category_id) as CategoryView
  }

  /**
   * Checks a classification and returns its canonical form. The category must exist (and be active when `offered` is true: a new product or a
   * changed category); a subcategory must belong to that category (matched ignoring case and accents) and, when offered, be active.
   */
  async resolve(categoryKey: string, subcategory: string | null | undefined, options: { offered: boolean }): Promise<{ category: string; subcategory: string | null }> {
    const category = await this.prisma.category.findUnique({ where: { key: categoryKey }, include: { subcategories: true } })
    if (!category) throw new BadRequestException(`A categoria "${categoryKey}" não existe no cadastro de categorias`)
    if (options.offered && category.status !== 'active') throw new BadRequestException(`A categoria ${category.name} está inativa e não é oferecida para produtos novos`)
    const text = typeof subcategory === 'string' ? subcategory.trim() : ''
    if (!text) return { category: category.key, subcategory: null }

    const sub = category.subcategories.find(row => normalizeName(row.name) === normalizeName(text))
    if (!sub) throw new BadRequestException(`A subcategoria "${text}" não pertence à categoria ${category.name}`)
    if (options.offered && sub.status !== 'active') throw new BadRequestException(`A subcategoria ${sub.name} está inativa e não é oferecida para produtos novos`)

    return { category: category.key, subcategory: sub.name }
  }

  /** Active taxonomy only: what classification and the forms offer. */
  async active(): Promise<TaxonomyCategory[]> {
    const categories = await this.prisma.category.findMany({ where: { status: 'active' }, include: { subcategories: { where: { status: 'active' }, orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } })

    return categories.map(category => ({ key: category.key, name: category.name, keywords: category.keywords, subcategories: category.subcategories.map(sub => ({ id: sub.id, name: sub.name, keywords: sub.keywords })) }))
  }

  async suggest(name: string): Promise<Classification> {
    return classifyName(name ?? '', await this.active())
  }

  /**
   * Proposals for products that have no subcategory or whose classification nobody confirmed. Only proposals that differ from what the product has
   * are listed; NOTHING is applied here.
   */
  async review(limit = 500): Promise<ReviewItem[]> {
    const taxonomy = await this.active()
    const products = await this.prisma.product.findMany({ where: { OR: [{ subcategory: null }, { classification_confirmed: false }] }, orderBy: { sku: 'asc' }, take: 2000 })
    const items: ReviewItem[] = []
    for (const product of products) {
      const { best } = classifyName(product.name, taxonomy)
      if (!best) continue
      const sameCategory = best.categoryKey === product.category
      const sameSub = normalizeName(best.subcategory ?? '') === normalizeName(product.subcategory ?? '')
      // A category-only match that agrees with the product says nothing new; a confirmed category is not second-guessed.
      if (sameCategory && (best.subcategory === null || sameSub)) continue
      if (!sameCategory && product.classification_confirmed) continue
      items.push({ sku: product.sku, name: product.name, current: { category: product.category, subcategory: product.subcategory, confirmed: product.classification_confirmed }, proposed: { category: best.categoryKey, categoryName: best.categoryName, subcategory: best.subcategory }, matched: best.matched })
      if (items.length >= limit) break
    }

    return items
  }

  /** Applies ONLY the items the operator selected, validating each against the taxonomy, and marks them confirmed. */
  async apply(items: { sku: string; category: string; subcategory?: string | null }[], actor: string): Promise<{ applied: number; results: { sku: string; ok: boolean; error?: string }[] }> {
    if (!actor.trim()) throw new BadRequestException('O usuário é obrigatório')
    if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('Escolha ao menos um item para aplicar')
    const results: { sku: string; ok: boolean; error?: string }[] = []
    for (const item of items) {
      try {
        const product = await this.prisma.product.findUnique({ where: { sku: item.sku } })
        if (!product) throw new NotFoundException(`Produto ${item.sku} não encontrado`)
        const resolved = await this.resolve(item.category, item.subcategory ?? null, { offered: true })
        await this.prisma.product.update({ where: { id: product.id }, data: { category: resolved.category, subcategory: resolved.subcategory, classification_confirmed: true } })
        results.push({ sku: item.sku, ok: true })
      } catch (error) {
        results.push({ sku: item.sku, ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }

    return { applied: results.filter(r => r.ok).length, results }
  }
}

