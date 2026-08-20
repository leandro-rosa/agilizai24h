# frontend

Workspace de frontends do Agiliz.AI. Ver [../CLAUDE.md](../CLAUDE.md) para
a visão geral do monorepo.

## Estado atual

- `apps/site/` — site institucional (marketing, Vite + React Router SPA).
  Ver [CLAUDE.md](apps/site/CLAUDE.md) (técnico) e
  [DESIGN.md](apps/site/DESIGN.md) (marca/visual).
- `apps/admin/` — painel de gestão interno (vendas, financeiro,
  abastecimento, estoque, produtos, lojas), Next.js — primeiro app Next.js
  do monorepo. Autenticado (sessão via cookie HTTP-only), dado real via
  `gateway-service` — sem mock desde `add-web-real-data`. Ver
  [CLAUDE.md](apps/admin/CLAUDE.md) (técnico) e
  [DESIGN.md](apps/admin/DESIGN.md) (marca/visual).
- `common/` — **vazio**. Vai concentrar componentes/hooks/slices RTK
  compartilhados entre os frontends futuros.

## Workspace e build

Ambos os apps fazem parte do workspace pnpm da raiz (sem `package-lock.json`
próprio) e são nomeados `@agiliz/site` e `@agiliz/admin`. Rode tudo da raiz:
`pnpm install`, `pnpm turbo run lint typecheck build`.

O **contexto de build do Docker é a raiz do repo** (`context: ../../..` +
`dockerfile:` explícito nos `docker-compose.yml`), porque o lockfile do
workspace vive lá — um contexto restrito à pasta do app não consegue instalar.

## Convenções

- **State e data-fetching**: RTK + RTK Query em todos os apps.
  `apps/admin` é a primeira implementação real, sobre `gateway-service`
  (nunca um serviço de domínio direto). `apps/site` ainda não usa — não
  tem `@reduxjs/toolkit` instalado (ver gap em
  [apps/site/CLAUDE.md](apps/site/CLAUDE.md)).
- **UI kit canônico**: shadcn/ui sobre Radix. `apps/site` hoje mistura
  Radix/shadcn com MUI (`@mui/material`/`@emotion`) — não é o padrão a
  replicar em novos apps. `apps/admin` segue o padrão limpo (sem MUI,
  `components.json` real via `shadcn` CLI).
- Cada app novo em `apps/<nome>` ganha seu próprio `CLAUDE.md` (stack,
  estrutura, scripts, gaps) **e** um `DESIGN.md` (identidade visual,
  paleta, tipografia, tom, estrutura de página) — e é listado aqui.
