import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  // Swagger is a deliberate deviation from the nestjs-microservice-architecture
  // skill's baseline: the repo's engineering standards require an OpenAPI
  // document per HTTP service, and gateway-service is a real consumer of it.
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('stores-service')
      .setDescription('The registry of physical Agiliz.AI locations')
      .setVersion('1.0')
      .build(),
  )
  SwaggerModule.setup('docs', app, document)

  const port = app.get(ConfigService).get<number>('PORT') ?? 3000
  await app.listen(port, '0.0.0.0')
}

void bootstrap()
