import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AxiosHttpClient } from '@app/http-client'
import { httpGet } from './http-read'

export interface StoreDto {
  id: number
  name: string
  status?: string
}

@Injectable()
export class StoresClient {
  constructor(
    private readonly http: AxiosHttpClient,
    private readonly config: ConfigService,
  ) {}

  async stores(correlationId?: string): Promise<StoreDto[]> {
    return (await httpGet<StoreDto[]>(this.http, `${this.config.getOrThrow<string>('STORES_SERVICE_URL')}/stores`, { correlationId })) ?? []
  }
}
