import { Injectable } from '@nestjs/common'
import {
  DeleteObjectCommand,
  DeleteObjectCommandOutput,
  GetObjectCommand,
  GetObjectCommandOutput,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
  PutObjectCommandOutput,
  S3Client,
  S3ClientConfig,
} from '@aws-sdk/client-s3'

import { ConfigService } from '@nestjs/config'
import { Readable } from 'stream'

export interface S3CustomConfig {
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  endpoint?: string
  forcePathStyle?: boolean
}

/**
 * ConfigService.get<boolean>(...) does NOT parse env strings into real
 * booleans — it just casts the generic type, so an env var like
 * `AWS_S3_FORCE_PATH_STYLE=true` stays the string `"true"` at runtime. The
 * AWS SDK's bucket-endpoint middleware does a strict `=== true` check on
 * `forcePathStyle`, so a truthy-but-non-boolean string silently falls
 * through to virtual-hosted-style addressing (`{bucket}.{host}`) instead of
 * path-style (`{host}/{bucket}`) — fatal against an S3-compatible endpoint
 * like LocalStack, whose DNS only resolves the plain host. Always route
 * through this parser instead of relying on ConfigService's cast.
 */
export function parseForcePathStyle(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return true
}

@Injectable()
export class S3Service {
  constructor(
    private readonly defaultS3Client: S3Client,
    private readonly configService: ConfigService,
  ) {}

  private getClient(config?: S3CustomConfig): S3Client {
    if (!config) {
      return this.defaultS3Client
    }

    const s3Config: S3ClientConfig = {
      region: config.region ?? this.configService.get<string>('AWS_REGION')!,
      credentials: {
        accessKeyId: config.accessKeyId ?? this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: config.secretAccessKey ?? this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
      },
      endpoint: config.endpoint ?? this.configService.get<string>('AWS_S3_ENDPOINT'),
      forcePathStyle: config.forcePathStyle ?? parseForcePathStyle(this.configService.get('AWS_S3_FORCE_PATH_STYLE')),
    }

    return new S3Client(s3Config)
  }

  async uploadFile(
    key: string,
    body: Buffer | Readable,
    contentType: string,
    options?: {
      bucket?: string
      connection?: S3CustomConfig
    },
  ): Promise<PutObjectCommandOutput> {
    const client = this.getClient(options?.connection)

    const command = new PutObjectCommand({
      Bucket: options?.bucket ?? this.configService.get<string>('AWS_S3_BUCKET') ?? '',
      Key: key,
      Body: body,
      ContentType: contentType,
    })

    return client.send(command)
  }

  /**
   * First real consumer of GetObjectCommand — apps/quote's ProcessUploadWorker
   * downloads the previously uploaded spreadsheet to parse it. Returns the
   * body as a Buffer since the sheeter reader operates on paths/streams and
   * the caller decides whether to write it to a temp file first.
   */
  async getFile(
    key: string,
    options?: {
      bucket?: string
      connection?: S3CustomConfig
    },
  ): Promise<{ body: Buffer; contentType?: string }> {
    const client = this.getClient(options?.connection)

    const command = new GetObjectCommand({
      Bucket: options?.bucket ?? this.configService.get<string>('AWS_S3_BUCKET') ?? '',
      Key: key,
    })

    const result: GetObjectCommandOutput = await client.send(command)
    const chunks: Buffer[] = []
    const stream = result.Body as Readable
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    return { body: Buffer.concat(chunks), contentType: result.ContentType }
  }
}
