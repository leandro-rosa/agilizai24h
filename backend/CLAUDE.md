# backend

Workspace NestJS do Agiliz.AI. Ver [../CLAUDE.md](../CLAUDE.md) para a
visão geral do monorepo.

## Estado atual

- `apps/` — **vazio**. Nenhum microserviço criado neste repo ainda.
- `common/nest-libs/` — 8 libs abstratas, prontas para serem consumidas
  por apps que ainda não existem.

Vários `CLAUDE.md` das libs abaixo mencionam apps consumidores (`quote`,
`search`, `bull-board`) e um workflow OpenSpec (`openspec/changes/...`) —
isso é histórico/aspiracional trazido de outro repositório: nem os apps
nem `openspec/` existem aqui hoje. Trate essas menções como o desenho de
integração pretendido, não como estado atual deste monorepo.

## `common/nest-libs/`

| Lib | Propósito |
|---|---|
| [aws](common/nest-libs/aws/CLAUDE.md) | `S3Service` (upload/download) sobre AWS SDK v3, compatível com endpoints S3 (MinIO/LocalStack) |
| [elasticsearch](common/nest-libs/elasticsearch/CLAUDE.md) | Wrapper de `@elastic/elasticsearch` com paginação PIT, `search`/`mget` |
| [health](common/nest-libs/health/CLAUDE.md) | Health-check genérico (`@nestjs/terminus`), ORM-agnóstico |
| [hold-it](common/nest-libs/hold-it/CLAUDE.md) | Abstração de message broker (BullMQ funcional, Kafka com gap conhecido) + workers + Bull Board |
| [http-client](common/nest-libs/http-client/CLAUDE.md) | `@nestjs/axios` com retry/backoff + camada de conveniência GraphQL |
| [prisma-db-client](common/nest-libs/prisma-db-client/CLAUDE.md) | Repositório base `PrismaRepository<T, Model>`, schema-agnóstico |
| [quote-search-match](common/nest-libs/quote-search-match/CLAUDE.md) | Contrato (filas + tipos) entre apps de quote e de search — sem lógica |
| [sheeter](common/nest-libs/sheeter/CLAUDE.md) | Leitura/escrita de planilhas/CSV sobre `hold-it` + `aws` |

Padrão de composição: `hold-it` é a base de que `elasticsearch`, `aws` e
`sheeter` dependem. Cada lib é um módulo `@Global()` focado em um serviço,
configurado via env vars.

## Convenções

- NestJS + Turborepo (orquestração ainda não configurada — ver
  [../CLAUDE.md](../CLAUDE.md)).
- Cada novo app em `apps/<nome>` ganha seu próprio `CLAUDE.md` (API
  pública/rotas, dependências entre libs/apps, gaps conhecidos) e é
  listado aqui.
