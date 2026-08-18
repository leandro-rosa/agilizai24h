# backend

Workspace NestJS do Agiliz.AI. Ver [../CLAUDE.md](../CLAUDE.md) para a
visão geral do monorepo.

## Estado atual

- `apps/` — 5 microserviços:
  [iam-service](apps/iam-service/CLAUDE.md) (contas, sessões, permissões),
  [stores-service](apps/stores-service/CLAUDE.md) (registro de lojas) e
  [products-service](apps/products-service/CLAUDE.md) (catálogo + custo datado)
  [gateway-service](apps/gateway-service/CLAUDE.md) (único ponto de entrada
  HTTP e fronteira de confiança) e
  [sales-service](apps/sales-service/CLAUDE.md) (vendas por loja/período/SKU).
  `iam-service` foi o primeiro e serve de molde para os próximos.
- `common/nest-libs/` — 10 libs: 8 abstratas mais dois pacotes de contrato sem
  lógica, [iam-contracts](common/nest-libs/iam-contracts/CLAUDE.md) (iam ↔
  gateway) e [products-contracts](common/nest-libs/products-contracts/CLAUDE.md)
  (products → finance/supply).

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
| [iam-contracts](common/nest-libs/iam-contracts/CLAUDE.md) | Nomes de permissão/role e shape da introspecção — contrato `iam-service` ↔ `gateway-service` |
| [products-contracts](common/nest-libs/products-contracts/CLAUDE.md) | `BulkCostResult` particionado + `Centavos` — contrato `products-service` → `finance`/`supply` |
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
  mapeamento `@app/*` em runtime.
- Cada app emite um `dist` **local a si** (`apps/<svc>/dist/`), com
  `rootDir` em `backend/` — então o build contém `apps/<svc>/src/` **e**
  `common/nest-libs/*/src/`. Rodar de dentro da pasta do app:
  `node -r ../../../register-paths.js dist/apps/<svc>/src/main.js`.
  O `dist` precisa ficar dentro do app porque, com o node_modules isolado do
  pnpm, um `dist` na raiz só alcança o node_modules da raiz — que não tem as
  dependências de runtime do serviço.
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
  `.env.example` na raiz. Melhor ainda, e é o que `sales-service` faz: passar
  `{ withKafkaBrokers: false }` no `register()` **e** exigir a env var na
  validação, para o serviço não depender de ninguém lembrar.
- **Dependência de lib é do app**: as libs `@app/*` compilam dentro do `dist`
  do app, então o Node resolve pelo `node_modules` do app. Toda dependência de
  runtime de uma lib precisa ser declarada também no app que a consome — já
  mordeu com `@nestjs/terminus`, `fastify` e `@bull-board/fastify`.
