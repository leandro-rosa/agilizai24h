# backend/apps/iam-service

Identidade e acesso da plataforma: contas de operador, credenciais, sessões e o
modelo de permissões de que toda decisão de acesso deriva. Primeiro microserviço
do repo — serve de molde para os próximos. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Único consumidor previsto**: `gateway-service`. Nenhum outro serviço fala com
este diretamente, e ele não é exposto fora da `agiliz_network`.

## Rotas

| Rota | Uso |
|---|---|
| `POST /auth/login` | Troca credenciais por um token de sessão opaco |
| `POST /auth/introspect` | Resolve o token em identidade + permissões efetivas — chamada do gateway a cada request |
| `POST /auth/logout` | Revoga a sessão imediatamente |
| `GET /users`, `GET /users/:id` | Lista/lê contas |
| `POST /users` | Cria conta (não há auto-cadastro) |
| `PATCH /users/:id/active` | Ativa/desativa — desativar revoga as sessões na mesma transação |
| `PATCH /users/:id/roles` | Troca roles — vale na próxima introspecção, sem novo login |
| `GET /health` | Liveness/readiness via `@app/health` |
| `GET /docs` | OpenAPI |

## Decisões que não são óbvias no código

- **Sessão opaca no Postgres, não JWT**: a spec exige revogação imediata no
  logout e na desativação. Um JWT continua válido até expirar, e uma denylist
  reintroduziria a consulta que o JWT existia para evitar.
- **Introspecção não estende a expiração**: ela roda a cada request; estender
  aqui tornaria a sessão eterna para qualquer usuário ativo.
- **Permissões resolvidas a cada introspecção**, não capturadas no login — é o
  que faz uma role revogada valer no próximo request.
- **Só o hash do token é persistido** (SHA-256), então um dump do banco não
  pode ser reproduzido como sessão válida.
- **E-mail duplicado é checado antes do insert**, não capturando erro do Prisma:
  `PrismaRepository` relança um `Error` genérico e descarta o código do Prisma,
  então `error.code === 'P2002'` não existe para ramificar. A constraint única
  segue como backstop da corrida que isso deixa.
- **Throttle é por conta, não por IP**: o gateway é o único chamador, então todo
  request chega do mesmo IP e limitar por IP seria inútil aqui.
- **Falha genérica + `dummyVerify()`**: e-mail inexistente gasta CPU comparável
  a uma verificação real, para que timing não enumere contas.

## Bootstrap do primeiro administrador

Idempotente, e não deixa senha padrão para trás:

```bash
IAM_BOOTSTRAP_EMAIL=... IAM_BOOTSTRAP_PASSWORD=... pnpm bootstrap:admin
```

Se já existir qualquer conta, não altera nada e informa. Roles e permissões em
si são semeadas por migration (são fatos estruturais, não config de ambiente),
a partir de `@app/iam-contracts`.

## Desvios deliberados do skill `nestjs-microservice-architecture`

- **Tem Swagger**, que o skill deixa fora do baseline — o §6 dos padrões de
  engenharia exige OpenAPI por serviço HTTP, e o gateway é consumidor real.
- **Não tem `tracing.ts`**: não há collector OTel neste repo, e seriam ~6
  dependências especulativas. Correlação de request é feita por
  `CorrelationIdMiddleware` (header `x-correlation-id`).
- **`dist` é local ao app** (`backend/apps/iam-service/dist`), não na raiz: sob
  o node_modules isolado do pnpm, um dist na raiz só enxerga o node_modules da
  raiz e não acha as dependências do serviço.

## Gaps conhecidos

- Sem rotação de senha, reset, verificação de e-mail, MFA ou SSO.
- Sem escopo por loja: `operator` é leitura em toda a rede. O modelo de
  permissões não impede acrescentar escopo depois, mas nada disso existe hoje.
- As rotas de `/users` ainda não exigem permissão — quem faz enforcement é o
  gateway, que ainda não existe. Até lá, este serviço não pode ser exposto.
- Sem testes e2e HTTP; a cobertura é unitária + integração contra Postgres real.
