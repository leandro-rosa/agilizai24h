# backend

Workspace NestJS do Agiliz.AI. Ver [../CLAUDE.md](../CLAUDE.md) para a
visão geral do monorepo.

## Estado atual

- `apps/` — **vazio**. Nenhum microserviço criado neste repo ainda.
- `common/nest-libs/` — 8 libs abstratas, prontas para serem consumidas
  por apps que ainda não existem.

Vários `CLAUDE.md` das libs abaixo mencionam apps consumidores (`quote`,
`search`, `bull-board`) — isso é histórico trazido de outro repositório;
esses apps não existem aqui. Trate essas menções como o desenho de
integração pretendido, não como estado atual. (`openspec/` já existe hoje —
ver [../openspec/project.md](../openspec/project.md).)

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

## Build e resolução de `@app/*`

- `tsconfig.json` (aqui) é a base que todo `apps/*/tsconfig.app.json`
  estende, e define o alias `@app/*`. São **dois patterns por lib**
  (`@app/hold-it` e `@app/hold-it/*`) de propósito: um único
  `@app/*` → `common/nest-libs/*/src` quebra imports com subpath, porque o
  wildcard engole o subpath e joga `src` para o fim.
- `common/tsconfig.json` é a base que cada `nest-libs/*/tsconfig.lib.json`
  estende (todos já assumiam esse arquivo).
- As libs são consumidas como **código-fonte TypeScript** via esse alias —
  não têm script `build` próprio e não emitem `dist`. Quem compila é o app
  que as importa; por isso existe o `register-paths.js` na raiz, que refaz o
  mapeamento `@app/*` em runtime sobre o `dist/` do app
  (`node -r ./register-paths.js dist/backend/apps/<svc>/main.js`).
- Cada lib tem `package.json` (`@app/<nome>`, privado) com scripts
  `typecheck` e `lint`. Dependências de framework (NestJS etc.) são
  `peerDependencies` — quem fixa a versão é o app consumidor.
- Dependências cross-lib **não** são declaradas como workspace deps:
  `hold-it` e `elasticsearch` se importam mutuamente, o que criaria um ciclo
  no grafo do Turborepo. A resolução é só pelo alias.

## Convenções

- NestJS + Turborepo (configurado — ver [../CLAUDE.md](../CLAUDE.md)).
- Cada novo app em `apps/<nome>` ganha seu próprio `CLAUDE.md` (API
  pública/rotas, dependências entre libs/apps, gaps conhecidos) e é
  listado aqui.
- Todo serviço que registrar `HoldItModule` precisa de
  `WITH_KAFKA_BROKERS=false` (env, docker-compose e testes) — ver
  `.env.example` na raiz.
