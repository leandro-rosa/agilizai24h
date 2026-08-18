import { ConflictException, Injectable, MethodNotAllowedException, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import { StoreRepository } from '../../db-client/repositories/store.repository'
import { DEFAULT_LISTED_STATUSES, type StoreStatus, type StoreType } from '../constants/store-vocabulary'

export interface StoreView {
  id: number
  name: string
  address: string
  city: string
  type: string
  status: string
  external_code: string | null
}

export interface CreateStoreInput {
  name: string
  address: string
  city: string
  type: StoreType
  external_code?: string
}

export interface UpdateStoreInput {
  name?: string
  address?: string
  city?: string
  type?: StoreType
  status?: StoreStatus
  external_code?: string | null
}

export interface ListStoresFilter {
  status?: StoreStatus[]
  type?: StoreType
  city?: string
}

@Injectable()
export class StoresService {
  constructor(
    private readonly stores: StoreRepository,
    private readonly prisma: PrismaClientService,
  ) {}

  async create(input: CreateStoreInput): Promise<StoreView> {
    if (input.external_code) {
      await this.assertExternalCodeAvailable(input.external_code)
    }

    const created = await this.prisma.store.create({ data: { ...input, status: 'active' } })

    return this.toView(created)
  }

  async update(id: number, input: UpdateStoreInput): Promise<StoreView> {
    const existing = await this.prisma.store.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException(`Store ${id} not found`)

    if (input.external_code) {
      await this.assertExternalCodeAvailable(input.external_code, id)
    }

    // `id` is never part of UpdateStoreInput, so the identifier is immutable by
    // construction rather than by a runtime guard that could be forgotten.
    const updated = await this.prisma.store.update({ where: { id }, data: input })

    return this.toView(updated)
  }

  async findById(id: number): Promise<StoreView> {
    const store = await this.prisma.store.findUnique({ where: { id } })
    if (!store) throw new NotFoundException(`Store ${id} not found`)

    return this.toView(store)
  }

  /**
   * Resolves the code the POS uses for a store. Reports "no match" rather than
   * falling back to matching on display name or returning an arbitrary store —
   * a wrong resolution here silently attributes one store's sales to another.
   */
  async findByExternalCode(externalCode: string): Promise<StoreView> {
    const store = await this.stores.findByExternalCode(externalCode)
    if (!store) throw new NotFoundException(`No store matches external code ${externalCode}`)

    return this.toView(store)
  }

  async list(filter: ListStoresFilter = {}): Promise<StoreView[]> {
    const stores = await this.prisma.store.findMany({
      where: {
        status: { in: filter.status?.length ? filter.status : DEFAULT_LISTED_STATUSES },
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.city ? { city: filter.city } : {}),
      },
      // Deterministic: `name` alone would reorder stores that share a name, so
      // `id` breaks the tie and repeated identical requests stay stable.
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })

    return stores.map(store => this.toView(store))
  }

  async setStatus(id: number, status: StoreStatus): Promise<StoreView> {
    return this.update(id, { status })
  }

  /**
   * Deletion is refused outright: past sales, supply and reconciliation records
   * reference stores, and they must keep resolving after a store closes.
   */
  delete(): never {
    throw new MethodNotAllowedException(
      'Stores are never deleted — set status to "inactive" instead, so historical records keep resolving',
    )
  }

  private async assertExternalCodeAvailable(externalCode: string, exceptStoreId?: number): Promise<void> {
    // Checked explicitly rather than by catching a unique-constraint violation:
    // PrismaRepository rethrows a generic Error and discards Prisma's error
    // code. The database constraint remains the backstop for the race.
    const owner = await this.stores.findByExternalCode(externalCode)

    if (owner && owner.id !== exceptStoreId) {
      throw new ConflictException(`External code ${externalCode} is already used by store ${owner.id}`)
    }
  }

  private toView(store: StoreView): StoreView {
    return {
      id: store.id,
      name: store.name,
      address: store.address,
      city: store.city,
      type: store.type,
      status: store.status,
      external_code: store.external_code,
    }
  }
}
