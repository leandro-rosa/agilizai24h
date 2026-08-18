import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import fastifyCookie from '@fastify/cookie'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())

  // The gateway owns the browser relationship: the session is an HTTP-only
  // cookie, so the frontend never reads or stores a token.
  //
  // The cast is the known @fastify/cookie + Nest adapter mismatch: the plugin's
  // type augments FastifyInstance with its own methods, so its signature no
  // longer matches the plain FastifyPluginCallback the adapter expects. It is a
  // typing artefact, not a runtime one.
  await app.register(fastifyCookie as unknown as Parameters<typeof app.register>[0])

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('gateway-service')
      .setDescription(
        'The single HTTP entrypoint for the Agiliz.AI admin panel. 401 = no or invalid session, 403 = authenticated but not permitted, 503 = identity service unavailable, 502 = a domain service is unavailable.',
      )
      .setVersion('1.0')
      .build(),
  )
  SwaggerModule.setup('docs', app, document)

  const port = app.get(ConfigService).get<number>('PORT') ?? 3000
  await app.listen(port, '0.0.0.0')
}

void bootstrap()
