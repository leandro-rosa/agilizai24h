# backend/apps/stores-service

Registro das lojas físicas do Agiliz.AI — a entidade pela qual todos os outros
domínios são chaveados: vendas, abastecimento, estoque e a reconciliação mensal
são todos calculados **por loja, por mês**. Ver
[../../CLAUDE.md](../../CLAUDE.md) para as convenções do workspace backend.

**Consumidores**: `gateway-service` (leituras do painel) e
`ingestion-worker-service` (resolve o código externo de cada arquivo enviado).
Não é exposto fora da `agiliz_network`.

## Rotas

| Rota | Uso |
|---|---|
| `GET /stores` | Lista, com filtros `status`/`type`/`city`. Sem filtro de status, só ativas |
| `GET /stores/by-external-code/:code` | Resolve o código do PDV para uma loja — usado pela ingestão |
| `GET /stores/:id` | Lê uma loja, em qualquer status |
| `POST /stores` | Cria |
| `PATCH /stores/:id` | Atualiza atributos mutáveis |
| `PATCH /stores/:id/status` | Muda o ciclo de vida |
| `DELETE /stores/:id` | **Sempre 405** — ver abaixo |
| `GET /health` | Liveness/readiness via `@app/health` |
| `GET /docs` | OpenAPI |

## Decisões que não são óbvias no código

- **Código externo é separado do id interno.** É o identificador que o PDV usa
  nos relatórios exportados. Resolver errado aqui atribui silenciosamente a
  venda de uma loja a outra, então `findByExternalCode` **reporta "não achei"**
  em vez de cair para match por nome ou devolver uma loja arbitrária.
- **Nullable**: uma loja pode ser cadastrada antes de o código ser conhecido.
- **Não existe deleção.** `DELETE` responde 405 apontando para desativação:
  vendas e reconciliações passadas referenciam lojas e precisam continuar
  resolvendo depois que a loja fecha. Loja inativa some da listagem padrão mas
  segue acessível por id e por código externo.
- **`id` é imutável por construção**: `UpdateStoreDto` simplesmente não tem o
  campo, em vez de um guard em runtime que alguém pode esquecer.
- **Ordenação determinística** `(name, id)` — só `name` reordenaria lojas
  homônimas entre requisições idênticas.
- **`status`/`type` são `String` no Prisma**, validados no DTO com `@IsIn`
  contra `store-vocabulary.ts`. Enum do Prisma exigiria migration a cada termo
  novo, e os dois vocabulários devem crescer.
- **Código duplicado é checado antes do insert**, não capturando erro do
  Prisma: `PrismaRepository` relança `Error` genérico e descarta o código do
  Prisma. A constraint única segue como backstop da corrida.

## Gaps conhecidos

- Sem autorização própria: quem faz enforcement é o gateway, que ainda não
  existe. Até lá este serviço não pode ser exposto.
- Sem paginação na listagem — a rede tem dezenas de lojas, não milhares.
  Revisitar quando isso deixar de ser verdade.
- Sem geolocalização, horário de funcionamento ou dados de contato do parceiro:
  nada disso é exigido pela reconciliação hoje.
