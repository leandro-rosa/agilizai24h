# backend/apps/gateway-service

O **único ponto de entrada HTTP** da plataforma e sua fronteira de confiança.
Tudo atrás dele assume que o chamador já foi autenticado e autorizado. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Consumidor**: `frontend/apps/admin`. **Depende de**: `iam-service` (todo
request), `stores-service` e `products-service` (por rota).

## Rotas

| Rota | Permissão | Nota |
|---|---|---|
| `POST /auth/login` | pública | Seta cookie HTTP-only; **não** devolve o token |
| `POST /auth/logout` | sessão | Revoga no IAM, depois limpa o cookie |
| `GET /auth/me` | sessão | Identidade + permissões, resolvidas na hora |
| `GET /stores`, `GET /stores/:id` | `stores:read` | |
| `POST /stores`, `PATCH /stores/:id` | `stores:write` | |
| `GET /products`, `GET /products/:id` | `products:read` | |
| `POST /products`, `POST /products/:sku/costs` | `products:write` | |
| `GET /overview` | `stores:read` | Agrega, com falha parcial explícita |
| `GET /health`, `GET /docs` | pública | |

## Semântica de falha — o ponto inteiro deste serviço

| Status | Significa | O painel deve |
|---|---|---|
| **401** | Sem sessão, ou sessão inválida/expirada/revogada | Mandar para o login |
| **403** | Autenticado, mas sem a permissão | Mostrar "sem permissão" — **nunca** deslogar |
| **503** | Não deu para **descobrir**: IAM inalcançável | Tentar de novo, **manter** a sessão |
| **502** | Um serviço de domínio está indisponível | Mostrar indisponível, manter a sessão |

Colapsar 401 e 503 é o que faz uma oscilação de dependência **deslogar a
empresa inteira** e destruir trabalho em andamento. Por isso `SessionService`
converte qualquer falha de transporte em 503, nunca em 401.

**Fail closed**: se a sessão não pôde ser validada por qualquer motivo, o
request não chega a serviço de domínio nenhum. Um 503 bloqueando trabalho
legítimo durante uma queda é estritamente melhor que vazar dado.

## Decisões que não são óbvias no código

- **BFF fino com rotas explícitas, não proxy transparente.** Um pass-through
  tornaria todo endpoint de domínio implicitamente público no instante em que
  fosse escrito, e a permissão exigida por rota não moraria em lugar nenhum.
  Custo aceito: acrescentar endpoint de domínio exige mexer aqui também — o que
  é justamente o ponto, força uma decisão sobre quem pode chamar.
- **Sem cache de sessão.** O `iam` promete revogação imediata e mudança de
  permissão valendo no request seguinte; qualquer cache quebra os dois, e de
  forma intermitente — o pior jeito de um controle de segurança falhar.
- **Sem banco de dados.** Exceção deliberada ao database-per-service: sessão
  mora no `iam` para a revogação ser autoritativa num lugar só.
- **`SessionGuard` é `APP_GUARD` global.** Rota nova nasce protegida; sair
  disso é explícito via `@Public()` — a direção segura para uma fronteira.
- **Permissão vem de `@app/iam-contracts`**, não de string literal: typo vira
  erro de compilação em vez de mudança silenciosa de acesso.
- **Sem lógica de negócio.** Roteamento, auth e agregação só. Qualquer cálculo
  aqui é sinal de review.

## Duas armadilhas de `@app/http-client` (`AxiosHttpClient`)

Nenhuma é óbvia pela assinatura, e as duas afetam a semântica acima:

1. **`send()` lança o erro axios cru**, que ainda carrega
   `error.response.status`. Passar `throw_on_exception: true` relança um `Error`
   simples e **perde o status** — sem ele, um 404 de serviço de domínio fica
   indistinguível do serviço estar fora. Por isso a flag **não** é usada.
2. **Ele tenta até 12 vezes com backoff exponencial.** Só 429 e `ECONNABORTED`
   são retentáveis, então conexão recusada falha rápido — mas um *timeout*
   retentaria por ~40s. `UpstreamClient` impõe um deadline geral
   (`UPSTREAM_DEADLINE_MS`), que é o que torna real o "502 rápido" em vez de um
   request pendurado.

## Testes

- Unitários (`pnpm test`): guard, mapeamento de erro, validação de env.
- Integração (`pnpm test:integration`): **não precisa de container nenhum**.
  Sobe a aplicação real e a dirige por HTTP com supertest contra um stub de
  upstream que o próprio teste controla — é o que torna os casos interessantes
  (inalcançável, lento, um 404 que precisa ser repassado) baratos e
  determinísticos, exercitando guard, filtro, cookie e cliente HTTP juntos.
  Cobre 401/403/503/502, ausência de cache de sessão, cookie HTTP-only, falha
  parcial no `/overview` e as rotas públicas.

## Gaps conhecidos

- Sem rotas de upload — `add-ingestion-flow` as acrescenta, e é quando este
  serviço passa a registrar `HoldItModule` (e vai precisar de
  `WITH_KAFKA_BROKERS=false`).
- Sem rate limiting além do throttle de auth do próprio `iam`.
- Sem cache de resposta: o tráfego é de um punhado de operadores, e cache só
  acrescentaria bugs de invalidação.
- Os containers **Postgres** dos serviços de domínio ainda publicam porta no
  host (5433/5434/5435) para rodar `prisma migrate` da máquina. Os *serviços*
  não publicam nada — mas em produção esses mapeamentos devem sair.
- Same-site vs CORS-com-credenciais ainda não decidido; `add-web-real-data`
  precisa resolver antes do painel ir para produção.
- A suíte de integração usa um stub de upstream, não os serviços reais. Isso é
  deliberado (determinismo, zero infra), mas significa que uma divergência de
  contrato entre gateway e um serviço de domínio não é pega aqui — só pelo
  teste e2e que `add-web-real-data` vai trazer.
