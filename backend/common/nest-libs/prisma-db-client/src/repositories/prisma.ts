import { SearchCriteriaInterface } from '../criteria'

/**
 * Abstract repository for handling database operations with Prisma.
 * Includes support for transactions and error handling.
 *
 * Deliberately not typed against a concrete PrismaClient — each app owns
 * its own schema-specific client (see e.g.
 * backend/apps/quote/src/modules/db-client) and passes the model delegate
 * (`prisma.quote`, `prisma.quoteItem`, ...) directly.
 */
export abstract class PrismaRepository<T, Model> {
  protected model: any
  protected entityName: string

  /**
   * Constructor for initializing the repository with a Prisma model delegate.
   * @param prisma - The app's concrete Prisma client instance.
   * @param model - Prisma model delegate.
   */
  protected constructor(
    protected readonly prisma: unknown,
    model: any,
    entityName: string,
  ) {
    this.model = model
    this.entityName = entityName

    // prisma.product.findMany()
  }

  protected async withErrorHandling(method: string, fn: () => Promise<any>, params?: any): Promise<any> {
    try {
      return await fn()
    } catch (error) {
      this.handleError(method, error, params)
    }
  }

  protected handleError(method: string, error: any, params?: any) {
    const paramsString = params
      ? JSON.stringify(params, (_, value) => (typeof value === 'bigint' ? value.toString() : value))
      : 'No parameters'
    const modelName = this.constructor.name

    console.error(
      `Error in ${method} method for model ${modelName}: ${error.message || error}. Params: ${paramsString}.`,
      error,
    )

    throw new Error(
      `Error in ${method} method for model ${modelName}: ${error.message || error}. Params: ${paramsString}.`,
    )
  }

  async findAll(criteria?: SearchCriteriaInterface<Model>): Promise<Partial<Model>[]> {
    // this.prisma.category.findMany({
    //   where: {
    //     parent_id: null,
    //     integration_source_id: 20,
    //   },
    //   orderBy: {
    //     parent_category_integration_source_id: 'asc',
    //   }
    // })
    return this.withErrorHandling(
      'findAll',
      async () => {
        const query = {
          where: criteria?.where,
          orderBy: criteria?.orderBy,
          take: criteria?.take,
          skip: criteria?.skip,
          include: criteria?.include,
          select: criteria?.select,
          distinct: criteria?.distinct,
          cursor: criteria?.cursor,
        }
        Object.keys(query).forEach(k => query[k] == null && delete query[k])

        const items = (await this.model.findMany(query)) || []

        return items
      },
      criteria,
    )
  }

  async count(criteria?: SearchCriteriaInterface<T>): Promise<number> {
    return this.withErrorHandling(
      'count',
      async () => {
        const query = {
          where: criteria?.where,
          orderBy: criteria?.orderBy,
          take: criteria?.take,
          skip: criteria?.skip,
          include: criteria?.include,
          select: criteria?.select,
          distinct: criteria?.distinct,
          cursor: criteria?.cursor,
        }
        Object.keys(query).forEach(k => query[k] == null && delete query[k])

        return this.model.count(query)
      },
      criteria,
    )
  }

  async findUnique(criteria?: Partial<SearchCriteriaInterface<T>>): Promise<Partial<Model> | null> {
    return this.withErrorHandling(
      'findUnique',
      async () => {
        if (!criteria) throw new Error('Criteria is required.')

        return this.model.findUnique(criteria)
      },
      criteria,
    )
  }

  async create(data: Partial<Model>): Promise<Partial<Model>> {
    return this.withErrorHandling(
      'create',
      async () => {
        return this.model.create({ data })
      },
      data,
    )
  }

  async createMany(data: Partial<Model>[], skipDuplicates = true): Promise<{ count: number } | null> {
    return this.withErrorHandling(
      'createMany',
      async () => {
        return this.model.createMany({ data, skipDuplicates })
      },
      data,
    )
  }

  async updateByCriteria(
    data: Partial<Model>,
    criteria: Partial<SearchCriteriaInterface<T>>,
  ): Promise<{ count: number } | null> {
    return this.withErrorHandling(
      'updateByCriteria',
      async () => {
        const result = await this.model.updateMany({
          ...criteria,
          data,
        })

        return result
      },
      { data, criteria },
    )
  }

  async updateMany(
    data: Partial<Model>,
    criteria: Partial<SearchCriteriaInterface<T>>,
  ): Promise<{ count: number } | null> {
    return this.withErrorHandling(
      'updateMany',
      async () => {
        return this.model.updateMany({ ...criteria, data })
      },
      { data, criteria },
    )
  }

  async update(id: number | string, data: Partial<Model>): Promise<Partial<Model> | null> {
    return this.withErrorHandling(
      'update',
      async () => {
        return this.model.update({ where: { id }, data })
      },
      { id, data },
    )
  }

  async createUpdate(criteria: SearchCriteriaInterface<any>, data: Partial<Model>): Promise<Partial<Model> | null> {
    return this.withErrorHandling(
      'createUpdate',
      async () => {
        return this.model.upsert({
          ...criteria,
          create: data,
          update: data,
        })
      },
      { criteria, data },
    )
  }

  async delete(id: number | string): Promise<boolean> {
    return this.withErrorHandling(
      'delete',
      async () => {
        const result = await this.model.delete({ where: { id } })
        return Boolean(result)
      },
      { id },
    )
  }

  async deleteMany(criteria: SearchCriteriaInterface<any>): Promise<boolean> {
    return this.withErrorHandling(
      'deleteMany',
      async () => {
        const result = await this.model.deleteMany(criteria)
        return Boolean(result)
      },
      criteria,
    )
  }

  async findFirst(criteria: SearchCriteriaInterface<Model>): Promise<Partial<Model> | null> {
    return this.withErrorHandling(
      'findFirst',
      async () => {
        return this.model.findFirst(criteria)
      },
      criteria,
    )
  }

  /** Delega para o delegate Prisma (by, where, _count, etc.) */
  async groupBy(args: Record<string, unknown>): Promise<any[]> {
    return this.withErrorHandling('groupBy', async () => this.model.groupBy(args), args)
  }
}
