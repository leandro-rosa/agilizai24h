import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ConfigService } from '@nestjs/config'
import { ValidationPipe } from '@nestjs/common'
import multipart from '@fastify/multipart'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
  // Spreadsheet upload (POST /quotes) streams the file through this plugin
  // rather than buffering the whole request body — see QuotesController.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const configService = app.get(ConfigService)
  const port = configService.get<number>('PORT') ?? 3000

  await app.listen(port, '0.0.0.0')
}

bootstrap()
