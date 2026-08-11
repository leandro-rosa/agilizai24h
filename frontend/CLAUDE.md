# frontend

Workspace de frontends do Agiliz.AI. Ver [../CLAUDE.md](../CLAUDE.md) para
a visão geral do monorepo.

## Estado atual

- `apps/site/` — site institucional, único app hoje. Ver
  [CLAUDE.md](apps/site/CLAUDE.md) (técnico) e
  [DESIGN.md](apps/site/DESIGN.md) (marca/visual).
- `common/` — **vazio**. Vai concentrar componentes/hooks/slices RTK
  compartilhados entre os frontends futuros.

## Convenções

- **State e data-fetching**: RTK + RTK Query em todos os apps. Nenhum app
  usa ainda — `apps/site` não tem `@reduxjs/toolkit` instalado (ver gap em
  [apps/site/CLAUDE.md](apps/site/CLAUDE.md)); a instalação fica para uma
  tarefa de scaffolding separada.
- **UI kit canônico**: shadcn/ui sobre Radix. `apps/site` hoje mistura
  Radix/shadcn com MUI (`@mui/material`/`@emotion`) — não é o padrão a
  replicar em novos apps.
- Cada app novo em `apps/<nome>` ganha seu próprio `CLAUDE.md` (stack,
  estrutura, scripts, gaps) **e** um `DESIGN.md` (identidade visual,
  paleta, tipografia, tom, estrutura de página) — e é listado aqui.
