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

`npm run dev` / `build` / `preview` (npm — ver gap de package manager
abaixo).

## Gaps conhecidos (não corrigidos aqui — documentação apenas)

- `package.json` tem `name: "@figma/my-make-file"`, sobra do export do
  Figma Make — precisa renomear.
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
- `package-lock.json` (npm) convive com um bloco `pnpm.overrides`
  vestigial no `package.json` — inconsistência de package manager, sem
  efeito prático hoje.
- RTK/RTK Query ainda não instalado — convenção do workspace, pendente de
  implementação.
