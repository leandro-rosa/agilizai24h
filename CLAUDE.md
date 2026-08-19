# ai-devbox — monorepo Agiliz.AI

Agiliz.AI é uma rede de mercados autônomos 24h instalados dentro de empresas
e condomínios no Brasil (sem operação, sem fila — "pega, paga e segue o
dia"). Este monorepo vai concentrar todos os sistemas: backend
(microserviços), múltiplos frontends, CLI interna, MCP servers e
observability.

## Mapa do repo

| Pasta | Estado hoje | Conteúdo |
|---|---|---|
| `backend/apps/` | vazio | futuros microserviços NestJS |
| `backend/common/nest-libs/` | 8 libs reais | ver [backend/CLAUDE.md](backend/CLAUDE.md) |
| `frontend/apps/site/` | app real | site institucional — ver [CLAUDE.md](frontend/apps/site/CLAUDE.md) / [DESIGN.md](frontend/apps/site/DESIGN.md) |
| `frontend/apps/admin/` | app real | painel de gestão (vendas, financeiro, abastecimento, estoque, produtos, lojas), Next.js — ver [CLAUDE.md](frontend/apps/admin/CLAUDE.md) / [DESIGN.md](frontend/apps/admin/DESIGN.md) |
| `frontend/common/` | vazio | futuras libs/hooks/slices RTK compartilhadas entre frontends |
| `cli/` | app real | `agiliz-cli` — CLI Docker Compose para a devbox — ver [cli/CLAUDE.md](cli/CLAUDE.md) |
| `docker/composes/` | infra real | `docker-compose.infra.yaml` (Redis + MinIO compartilhados). Os outros 3 arquivos são sobras de um projeto anterior ("smartparts") — não usar |
| `mcp-servers/`, `observability/` | vazios/placeholder | sem CLAUDE.md até terem conteúdo real |

Workspace tooling configurado: pnpm workspaces + Turborepo na raiz
(`package.json`, `pnpm-workspace.yaml`, `turbo.json`), bases de TypeScript em
`backend/tsconfig.json` (alias `@app/*`) e ESLint compartilhado
(`eslint.base.mjs` / `eslint.backend.mjs` / `eslint.frontend.mjs`).

## Stack-alvo

Decisões de convenção para todo o monorepo, ainda não todas implementadas
em código:

- **Orquestração**: Turborepo + pnpm workspaces (configurado).
- **Backend**: NestJS. Módulos globais focados (padrão já usado nos
  `nest-libs`), um `CLAUDE.md` por app/lib.
- **Frontend**: RTK + RTK Query para state management e data-fetching em
  todos os apps (`frontend/apps/admin` é a primeira implementação real;
  `frontend/apps/site` ainda não usa — ver
  [frontend/CLAUDE.md](frontend/CLAUDE.md)). shadcn/Radix como kit de UI
  canônico.
- **Mudanças não-triviais**: workflow OpenSpec (propose → apply →
  archive), já inicializado em `openspec/` (CLI `@fission-ai/openspec`).
  Contexto canônico do projeto em
  [openspec/project.md](openspec/project.md); `openspec/config.yaml` carrega
  uma versão condensada das restrições. Referências a `openspec/changes/...`
  em alguns `CLAUDE.md` de libs continuam sendo histórico de outro repo.

## Começando

Requer **Node 24** (ver `.nvmrc`) e **pnpm** (via `corepack enable pnpm`; a
versão vem fixada em `packageManager`).

```bash
pnpm install                    # instala todo o workspace a partir da raiz
pnpm turbo run lint typecheck   # valida todos os pacotes
cp .env.example .env            # WITH_KAFKA_BROKERS=false já vem no template
cli/agiliz-cli up               # sobe infra (Redis/MinIO) + site + admin
```

`cli/agiliz-cli up` respeita a ordem `infra → site → admin`; `down` inverte.
Se as portas padrão de Redis/MinIO já estiverem ocupadas na sua máquina,
sobrescreva `REDIS_HOST_PORT` / `MINIO_HOST_PORT` / `MINIO_CONSOLE_HOST_PORT`.

## Convenções para trabalhar aqui (redução de tokens)

- **Claude Code carrega `CLAUDE.md` hierarquicamente** por pasta de
  trabalho — por isso cada pacote tem o seu, curto e específico, em vez de
  um único arquivo gigante na raiz. Não duplique aqui o que já está no
  `CLAUDE.md` de uma pasta filha, nem descreva o que é derivável lendo o
  código (estrutura de pastas óbvia, imports, etc).
- Formato de referência: os 8 `CLAUDE.md` em `backend/common/nest-libs/*`
  são o padrão a seguir — API pública, consumidores, gaps conhecidos.
  Nada de prosa genérica sobre o que já está óbvio no código.
- Para explorar o repo à medida que ele cresce (muitos microserviços e
  frontends), prefira a skill `graphify` a buscas manuais amplas.
- Para sessões longas ou repetitivas, o modo `caveman` reduz tokens de
  saída sem perder precisão técnica.

## Suporte à decisão financeira

Para qualquer pergunta financeira — economia de loja, KPIs de varejo,
estoque como capital, caixa, capital de giro, precificação, fornecedores,
CAPEX, payback, ROI/ROIC ou alocação de capital — a skill autoritativa do
projeto é `.claude/skills/autonomous-retail-cfo/`
([SKILL.md](.claude/skills/autonomous-retail-cfo/SKILL.md)); conhecimento
financeiro detalhado vive lá, não aqui. Arquitetura completa (plugins
instalados, decisão sobre OpenFPA, estratégia de memória financeira) em
[docs/financial-ai-architecture.md](docs/financial-ai-architecture.md).

Regras que valem para qualquer recomendação financeira, sem exceção:

- `backend/apps/finance-service` é a fonte de verdade para CMV, sobra e
  perda real por loja/mês — a skill lê esses números, nunca os re-deriva.
- Todo número é rotulado FATO, MÉTRICA DERIVADA, PREMISSA ou ESTIMATIVA;
  nunca apresentar uma premissa como fato.
- Evidência da empresa (via `finance-service`, documentos reais, ou
  `.fpa/`) tem precedência sobre benchmarks genéricos — inclusive os da
  skill `charlie`, que são de SaaS/startup e não se aplicam aqui sem
  validação explícita.
- Cálculos devem ser reprodutíveis — preferir
  `.claude/skills/autonomous-retail-cfo/scripts/retail_finance.py` a fazer
  a aritmética livre.
- Nenhuma ação financeira consequente (transferência, pagamento a
  fornecedor, lançamento contábil, abertura/fechamento de loja, mudança de
  preço em produção) é executada sem aprovação humana explícita fora desta
  skill.
- Memória financeira durável da empresa vive em
  [`.fpa/`](.fpa/MEMORY.md) — ler antes de responder algo que dependa de
  contexto anterior, e gravar fatos/decisões novos lá em vez de
  re-estabelecê-los a cada sessão.

## Criando um novo microserviço ou frontend

1. Crie a pasta em `backend/apps/<nome>` ou `frontend/apps/<nome>`.
2. Escreva o `CLAUDE.md` do pacote: propósito, API pública/rotas,
   dependências de outras libs/apps do monorepo, gaps conhecidos. Curto —
   sem repetir o que este arquivo raiz já cobre.
3. Se for frontend, escreva também um `DESIGN.md` (identidade visual,
   paleta, tipografia, componentes, tom) — ver
   [frontend/apps/site/DESIGN.md](frontend/apps/site/DESIGN.md) como
   exemplo.
4. Linke o novo pacote no índice do `CLAUDE.md` do workspace pai
   (`backend/CLAUDE.md` ou `frontend/CLAUDE.md`).
