# frontend/apps/site

Site institucional do Agiliz.AI (agiliz.ai). Ver
[../../CLAUDE.md](../../CLAUDE.md) para convenções do workspace frontend e
[DESIGN.md](DESIGN.md) para identidade visual/marca.

## Stack

Vite 6 + React 18 + React Router v7 (`createBrowserRouter`, sem SSR/data
loaders — só client-side routing). Tailwind v4. shadcn/ui (~45 componentes
Radix-based já presentes em `src/app/components/ui/`). Origem: export do
"Figma Make" — ver gaps abaixo.

## Estrutura

- `src/main.tsx` → `src/app/App.tsx` (`RouterProvider`) → `src/app/routes.tsx`
  (tabela de rotas, todas sob `Layout`).
- `src/app/pages/` — mapeamento 1:1 rota→página: `Home`, `Empresas`,
  `Condominios`, `Produtos`, `Sobre`, `Contato`.
- `src/app/components/` — `Layout`, `Header`, `Footer`, `figma/ImageWithFallback`,
  e `ui/` (shadcn).
- `src/styles/` — `index.css` importa `fonts.css` → `tailwind.css` →
  `theme.css` (tokens de design, ver [DESIGN.md](DESIGN.md)).
- `src/imports/pasted_text/agiliz-ai-marketing-site.md` — brief de conteúdo/
  copy original de cada página; fonte primária do `DESIGN.md`.

## Scripts

`pnpm dev` / `build` / `preview` / `lint`. Pacote: `@agiliz/site`, membro do
workspace pnpm da raiz — instale sempre pela raiz, não aqui.

## Gaps conhecidos (não corrigidos aqui — documentação apenas)

- Sem `tsconfig.json` e sem `typescript` instalado, apesar de ~60 arquivos
  `.tsx`/`.ts`: o Vite transpila via esbuild sem checar tipos. Por isso este
  app não participa do `typecheck` do Turborepo — adicionar TypeScript de
  verdade aqui é uma mudança à parte.
- `src/styles/fonts.css` está vazio — nenhuma fonte customizada é
  carregada apesar do DESIGN.md pedir uma sans-serif específica.
- `theme.css` usa os tokens genéricos do shadcn (`--primary: #030213`,
  OKLCH neutros) — não reflete a paleta de marca. Cor de marca hoje está
  hardcoded em classes Tailwind soltas (`pink-500`, `purple-600`,
  `zinc-950`) em `Header.tsx`/`Footer.tsx`, não centralizada nos tokens.
- Mistura MUI (`@mui/material`, `@emotion/*`) com Radix/shadcn — dois
  sistemas de UI coexistindo; shadcn é o padrão do workspace (ver
  [../../CLAUDE.md](../../CLAUDE.md)), MUI não deveria ser usado em código
  novo.
- ESLint só passa a valer para código novo: `src/app/components/ui/**`,
  `components/figma/**` e `imports/**` estão em `globalIgnores` por serem
  vendorizados/gerados.
- RTK/RTK Query ainda não instalado — convenção do workspace, pendente de
  implementação.
