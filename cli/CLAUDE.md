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
seu diretório, arquivo Compose e serviços dev/production. Hoje só existe:

| Projeto | Diretório | Compose | Dev | Production |
|---|---|---|---|---|
| `site` | `frontend/apps/site` | `docker-compose.yml` | `site-dev` | `site-prod` |

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
  removida porque não há serviço de banco de dados aqui ainda —
  reintroduzir quando `backend/apps` ganhar um serviço que dependa disso.
- Sem testes automatizados para o script.
