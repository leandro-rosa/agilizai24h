import { Injectable } from '@nestjs/common'
import { PrismaRepository } from '@app/prisma-db-client/repositories/prisma'
import { PrismaClientService } from '../prisma-client.service'
import { ColumnMappingTemplate } from '../entities/column-mapping-template.entity'

@Injectable()
export class ColumnMappingTemplateRepository extends PrismaRepository<ColumnMappingTemplate, ColumnMappingTemplate> {
  constructor(prisma: PrismaClientService) {
    super(prisma, prisma.columnMappingTemplate, 'ColumnMappingTemplate')
  }
}
