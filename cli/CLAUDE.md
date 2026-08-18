# cli

`agiliz-cli` — wrapper Bash sobre Docker Compose para gerenciar os
projetos dockerizados da devbox. Ver [../CLAUDE.md](../CLAUDE.md) para a
visão geral do monorepo.

## Uso

```
cli/agiliz-cli <command> [options]
cli/agiliz-cli --help
source <(cli/agiliz-cli completion bash)
```

Commands: `up`, `down`, `logs`, `stats`, `exec`, `deploy:pull`,
`completion`. Cada um tem `--help` próprio. `-i/-e` filtram projetos por
inclusão/exclusão (repetível ou CSV); `exec` recebe `PROJECT SERVICE
[COMMAND]` como alvo único e não usa `-i/-e`.

`AGILIZ_ROOT` sobrescreve a raiz do repo (padrão: diretório pai de
`cli/`).

## Modo dev/production

`up`, `down`, `logs`, `stats` e `deploy:pull` operam por padrão sobre o
serviço de **desenvolvimento** de cada projeto (ex.: `site-dev`). Passar
`--production` troca o alvo para o serviço de produção (ex.:
`site-prod`). O mapeamento fica em `PROJECT_DEV_SERVICE`/
`PROJECT_PROD_SERVICE`; um projeto sem entrada nesses mapas é afetado por
inteiro (todos os serviços do seu Compose file) em ambos os modos.
`exec` não é afetado — recebe o serviço explicitamente.

## Rede compartilhada

Todo serviço deve se comunicar diretamente pela rede Docker externa
`agiliz_network` (constante `SHARED_NETWORK_NAME` no script), em vez de
depender da rede default por projeto que o Compose criaria sozinho.
`ensure_shared_network` cria essa rede de forma idempotente antes de
qualquer `up`/deploy. Cada `docker-compose.yml` de projeto precisa
declará-la como `external: true` e anexar todos os seus serviços a ela —
ver [../frontend/apps/site/docker-compose.yml](../frontend/apps/site/docker-compose.yml)
como referência.

## Registro de projetos

O script mantém um registro estático (`VALID_PROJECTS`,
`PROJECT_DIRECTORIES`, `PROJECT_FILES`, `PROJECT_DEV_SERVICE`,
`PROJECT_PROD_SERVICE`, `UP_ORDER`, `DOWN_ORDER`) mapeando cada projeto ao
seu diretório, arquivo Compose e serviços dev/production. Hoje:

| Projeto | Diretório | Compose | Dev | Production |
|---|---|---|---|---|
| `infra` | `docker/composes` | `docker-compose.infra.yaml` | — | — |
| `iam` | `backend/apps/iam-service` | `docker-compose.yml` | `iam-dev` | `iam-prod` |
| `stores` | `backend/apps/stores-service` | `docker-compose.yml` | `stores-dev` | `stores-prod` |
| `products` | `backend/apps/products-service` | `docker-compose.yml` | `products-dev` | `products-prod` |
| `gateway` | `backend/apps/gateway-service` | `docker-compose.yml` | `gateway-dev` | `gateway-prod` |
| `site` | `frontend/apps/site` | `docker-compose.yml` | `site-dev` | `site-prod` |
| `admin` | `frontend/apps/admin` | `docker-compose.yml` | `admin-dev` | `admin-prod` |

`infra` (Redis + MinIO compartilhados) **sobe primeiro e desce por último** —
serviços de backend dependem dele para BullMQ (`@app/hold-it`) e storage S3
(`@app/aws`). Não tem distinção dev/production de propósito: por não estar em
`PROJECT_DEV_SERVICE`/`PROJECT_PROD_SERVICE`, é afetado por inteiro nos dois
modos. Suas portas de host são sobrescrevíveis (`REDIS_HOST_PORT`,
`MINIO_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT`) para não colidir com outros
serviços já rodando na máquina.

## Adicionando um novo projeto

Ao criar um novo app dockerizado em `backend/apps/<nome>` ou
`frontend/apps/<nome>` (ver [../CLAUDE.md](../CLAUDE.md)):

1. No `docker-compose.yml` do app, declare `agiliz_network` como rede
   externa e anexe todos os serviços a ela (ver seção acima).
2. Registre o projeto no script: adicione uma entrada em
   `VALID_PROJECTS`, `PROJECT_DIRECTORIES`, `PROJECT_FILES` e na posição
   correta de `UP_ORDER`/`DOWN_ORDER` (ordem de dependência entre
   serviços). Se o app distinguir dev/production, registre também em
   `PROJECT_DEV_SERVICE`/`PROJECT_PROD_SERVICE`.
3. Atualize a tabela acima e a seção `PROJECTS` do `--help`.

## Gaps conhecidos

- Adaptado de uma CLI equivalente de outro projeto (histórico:
  `smart-parts-cli`); a lógica de migrations Prisma daquele projeto foi
  removida. Agora que `iam-service` existe e tem migrations próprias, vale
  reintroduzir — hoje `prisma migrate deploy` é rodado à mão por serviço.
- `docker/composes/` ainda guarda 3 arquivos herdados desse mesmo projeto
  anterior (`docker-compose.redis.yaml`, `.observability.yaml`, `.cli.yaml`),
  que referenciam apps inexistentes e redes que este repo não usa. Só
  `docker-compose.infra.yaml` está registrado na CLI; limpar os outros é uma
  mudança à parte.
- Sem testes automatizados para o script.
