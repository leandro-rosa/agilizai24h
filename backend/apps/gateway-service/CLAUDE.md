# backend/apps/gateway-service

O **único ponto de entrada HTTP** da plataforma e sua fronteira de confiança.
Tudo atrás dele assume que o chamador já foi autenticado e autorizado. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Consumidor**: `frontend/apps/admin`. **Depende de**: `iam-service` (todo
request) e, por rota, dos 12 serviços de domínio — `stores`, `products`,
`sales`, `supply`, `inventory`, `finance`, `ingestion-worker`, `suppliers`,
`treasury`, `accounting`, `billing` e `capex`.

## Rotas

| Rota | Permissão | Nota |
|---|---|---|
| `POST /auth/login` | pública | Seta cookie HTTP-only; **não** devolve o token |
| `POST /auth/logout` | sessão | Revoga no IAM, depois limpa o cookie |
| `GET /auth/me` | sessão | Identidade + permissões, resolvidas na hora |
| `GET /stores`, `GET /stores/:id` | `stores:read` | |
| `POST /stores`, `PATCH /stores/:id` | `stores:write` | |
| `GET /products`, `GET /products/:id` | `products:read` | |
| `GET /products/:id/costs` | `products:read` | Histórico de custo |
| `POST /products/costs/bulk` | `products:read` | Custo de vários SKUs numa data — nunca "custo atual" sem data |
| `POST /products`, `POST /products/:sku/costs` | `products:write` | |
| `GET /sales/:storeId`, `GET /sales/:storeId/totals` | `sales:read` | Exige `?period=` |
| `GET /sales/:storeId/transactions` | `sales:read` | Detalhe por transação (`add-sales-transaction-detail`) — 404 se a loja/período não tiver, exige `?period=` |
| `GET /supply/reasons` | `supply:read` | O vocabulário de motivo de remoção |
| `GET /supply/:storeId`, `GET /supply/:storeId/loss` | `supply:read` | Exige `?period=` |
| `GET /inventory/:storeId`, `.../below-minimum`, `.../minimums` | `inventory:read` | `period` opcional (padrão: mais recente) |
| `GET /inventory/audit/balance?from=&to=` | `inventory:read` | Auditoria de qualidade do saldo (`add-stock-quality-phase0`): só distribuições, sem veredito/tolerância. Declarada antes de `:storeId`; `from`/`to` `YYYY-MM` validados aqui (400) |
| `GET /ingestions/gaps?from=&to=` | `inventory:read` (não `ingestion:read`) | Operações/linhas sem `Cliente` (CD) por período — a aba "Qualidade do saldo" junta com a auditoria, então quem vê uma vê a outra. Declarada antes de `GET /ingestions/:id` |
| `PUT /inventory/:storeId/:sku/minimum` | `inventory:write` | |
| `GET /finance/:storeId/:period`, `GET /finance/:storeId`, `GET /finance/rollup` | `finance:read` | A reconciliação mensal |
| `POST /finance/:storeId/:period/recompute` | `finance:read` | Não cria nada que o leitor já não pudesse ver — só re-deriva |
| `GET/POST /suppliers`, `GET/PATCH /suppliers/:id` | `suppliers:read` / `:write` | |
| `POST /suppliers/resolve` | `suppliers:read` | Lote de grafias → `{ matched, unmatched }`; é leitura apesar do POST |
| `POST /suppliers/:id/aliases`, `DELETE /:id/aliases/:aliasId` | `suppliers:write` | |
| `/treasury/accounts`, `/treasury/transactions`, `/treasury/mappings`, `/treasury/fees`, `/treasury/settlements`, `/treasury/categories` | `treasury:read` / `:write` | 24 rotas; `GET /treasury/transactions/summary` traz `unresolved_count`, `movement_cents`, `pending_count`/`pending_cents`; `.../by-supplier` consolida entre contas; `.../cash-flow` (regime de caixa, por `occurred_on`, usado só pela tela Fluxo de caixa — diferente de `summary`, que é por `period`); `.../neutralization-candidates` só sugere, `POST .../neutralize` (`:write`) vincula; `PATCH .../transactions/bulk` (`:write`, declarada antes de `:id` de propósito) aplica `nature`/`category` em lote — `nature` só grava nas linhas selecionadas com `kind: expense`, ignora as demais sem erro |
| `POST /treasury/imports/upload` | `treasury:write` | Multipart, até 6 arquivos (campo = fonte); grava no S3, chama `ingestion-worker-service` uma vez por arquivo — nunca fila direto (design de `add-ingestion-flow`, repetido aqui) |
| `GET /treasury/imports`, `GET /treasury/imports/:id` | `treasury:read` | A conferência — imports `staged`/`confirmed`/`rejected` |
| `PATCH /treasury/imports/:id/transactions/:txId[/proof]` | `treasury:write` | Corrige a sugestão / anexa comprovante (o `/proof` é o único endpoint de tesouraria que aceita arquivo além do upload principal) |
| `POST /treasury/imports/:id/confirm`, `.../reject` | `treasury:write` | Vira `BankTransaction` em lote, ou descarta |
| `/accounting/accounts`, `/accounting/entries`, `/accounting/pnl/*`, `/accounting/cash-flow` | `accounting:read` / `:write` | 11 rotas; `POST /accounting/pnl/:period/compute` congela o mês |
| `/billing/clients`, `/billing/contracts`, `/billing/invoices`, `/billing/revenue-shares` | `billing:read` / `:write` | 17 rotas; `GET /billing/invoices/aging` deriva o vencido |
| `/capex/investments`, `/capex/items`, `/capex/investors` | `capex:read` / `:write` | 16 rotas; `GET /capex/investments/payback` é MÉTRICA DERIVADA |
| `GET /products/:id/prices`, `POST /products/:sku/prices` | `products:read` / `:write` | Preço de venda datado, espelhando custo |
| `POST /products/prices/bulk` | `products:read` | Particionado, nunca mapa |
| `GET/POST /inventory/central`, `PATCH`/`DELETE /inventory/central/:id` | `inventory:read` / `:write` | Estoque do CD, por lote, com validade |
| `GET /inventory/central/summary` | `inventory:read` | |
| `GET /drive-files`, `GET /drive-files/status` | `ingestion:read` | Arquivos do Google Drive e a última sincronização (`add-drive-ingestion-source`). Caminho de topo de propósito: sob `/ingestions/…` colidiria com `GET /ingestions/:id`. Nenhuma resposta carrega credencial |
| `POST /drive-files/scan`, `/:id/validate`, `/:id/import`, `/:id/ignore` | `ingestion:upload` | Só repassa ao `ingestion-worker-service` e injeta `confirmed_by` da sessão, **sobrescrevendo** o que o browser mandar. O corpo de erro do worker (`code` + detalhes) é repassado inteiro pelo controller: o filtro compartilhado só leva status e mensagem e derrubaria o `code` de que a tela precisa |
| `GET /treasury-drive-files`, `GET /treasury-drive-files/status` | `treasury:read` | Arquivos de extrato bancário/fatura de cartão (Itaú, C6) do segundo Google Drive root folder, "Extratos" (`add-treasury-drive-statement-sync`). Mesma pattern que `/drive-files` — metadados + listagem sem download. Caminho de topo de propósito: sob `/treasury/…` colidiria com a permissão `treasury:*` mas os arquivos são recurso separado, e `/treasury-drive-files` espelha `/drive-files` (ambos top-level). Nenhuma resposta carrega credencial |
| `POST /treasury-drive-files/scan`, `/:id/import`, `/:id/ignore` | `treasury:write` | Só repassa ao `ingestion-worker-service` (`@Body() body: unknown`, sem injetar nada na sessão — diferente de `/drive-files`, este controller nunca sobrescreve `confirmed_by`). `scan` enfileira um job, `import` e `ignore` alteram o status. Sem `:id/validate` — não há conceito de cobertura por dia para extrato; "reconhecido" ou "não" é decidido na leitura, não numa segunda passagem |
| `GET/POST /purchases`, `GET /purchases/summary`, `GET /purchases/:id`, `PATCH /purchases/items/:itemId`, `POST /purchases/import` | `suppliers:read` / `suppliers:write` | Compras (suppliers-service). `import` guarda o XML bruto no S3, chama o parser (ingestion) e a resolução (suppliers) e devolve a prévia; **não grava compra** |
| `GET /settlements`, `/settlements/open-total`, `/settlements/:id`, `POST /settlements/propose`, `:id/confirm`, `:id/pay` | `suppliers:read` / `suppliers:write` | Acerto semanal; `propose`/`confirm`/`pay` devolvem 200 |
| `GET /overview` | `stores:read` | Agrega, com falha parcial explícita |
| `GET /analysis/suppliers/:id`, `/analysis/products/:sku`, `/analysis/cross` | `supply:read` | Proxy p/ intelligence-service; orçamento próprio `INTELLIGENCE_TIMEOUT_MS` (60 s) — a análise lê todas as lojas num cache frio |
| `GET /health`, `GET /docs` | pública | |

**Análise (`/analysis/*`)** → `intelligence-service` (`INTELLIGENCE_SERVICE_URL`, obrigatória), `supply:read`.
Orçamento próprio de timeout (`INTELLIGENCE_TIMEOUT_MS`, padrão 60 s): em cache frio lê todas as lojas por 6 meses.

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

## Um jeito de travar o request inteiro: parte de multipart não drenada

`TreasuryImportsController.upload()` itera `request.parts()` (`@fastify/
multipart`) e, para um `fieldname` de arquivo desconhecido, fazia só
`continue` — sem consumir o stream daquela parte. **`@fastify/multipart`
exige que toda parte tipo arquivo seja drenada antes de conseguir parsear a
próxima ou finalizar o request; pular sem drenar trava o request inteiro
pra sempre, sem resposta nenhuma, nem erro.** Achado ao vivo (não em teste):
um build desatualizado do gateway que ainda não conhecia uma fonte nova
(`pagseguro_invoice`, `add-treasury-statement-ingestion` design D11) travou
o upload correspondente indefinidamente. Correção: `part.file.resume()`
antes do `continue` — descarta o stream sem bufferizar. Mesma armadilha
existiria pra QUALQUER `fieldname` desconhecido (nome errado, campo extra),
não só pra essa causa específica — a correção é geral, não um workaround
pontual. Sem teste de integração automatizado ainda (a suíte atual não tem
infraestrutura de stub pra S3/multipart desse controller) — verificado só
ao vivo, contra o stack Docker real.

## Testes

- Unitários (`pnpm test`): guard, mapeamento de erro, validação de env.
- Integração (`pnpm test:integration`): **não precisa de container nenhum**.
  Sobe a aplicação real e a dirige por HTTP com supertest contra um stub de
  upstream que o próprio teste controla — é o que torna os casos interessantes
  (inalcançável, lento, um 404 que precisa ser repassado) baratos e
  determinísticos, exercitando guard, filtro, cookie e cliente HTTP juntos.
  Cobre 401/403/503/502, ausência de cache de sessão, cookie HTTP-only, falha
  parcial no `/overview` e as rotas públicas.

## CORS

O painel e o gateway são origens diferentes mesmo em dev (portas diferentes
em localhost) — `ADMIN_ORIGIN` (env, obrigatória) é a origem exata liberada
via `app.enableCors({ origin, credentials: true })` em `main.ts`. Não dá para
usar `*`: CORS proíbe wildcard junto com `Access-Control-Allow-Credentials`,
e o cookie de sessão precisa ir com credenciais. Resolve a decisão "same-site
vs CORS-com-credenciais" que ficava em aberto aqui (design de
`add-web-real-data`).

## Gaps conhecidos

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

## Pedidos em etapas e e-mail (`add-purchase-orders-and-email`)

`PurchasesController` ganhou `POST /purchases/:id/transition`, `PATCH /purchases/:id`, `GET /purchases/:id/history`, `GET /purchases/:id/email-preview`, `POST /purchases/:id/send` e `GET /purchases/payments/pending` (`suppliers:read`/`suppliers:write`). O ator (`created_by`/`sent_by`/`received_by`…) é **sempre `caller.email` da sessão**: o gateway sobrescreve qualquer `actor` vindo no corpo (`asActor`).
