# frontend/apps/admin

Painel de gestão interno do Agiliz.AI — vendas, financeiro, abastecimento,
estoque, produtos e lojas. Hoje essa gestão é feita no sistema terceiro
touchpay; este app é o novo front de gestão, começando pelo shell
navegável com dados mockados. Ver [../../CLAUDE.md](../../CLAUDE.md) para
convenções do workspace frontend e [DESIGN.md](DESIGN.md) para identidade
visual/marca.

## Stack

Next.js 16 (App Router, TypeScript, Turbopack), Tailwind v4, shadcn/ui
(base `radix`, style `nova`) escalfolded via `npx shadcn@latest`. RTK +
RTK Query — primeira implementação real dessa convenção do workspace (ver
gap em [../CLAUDE.md](../CLAUDE.md)). `next/font/google` (Inter) em vez
de um `fonts.css` vazio como no `site`.

Diferente do `site` (Vite + React Router SPA), este é o primeiro app
Next.js do monorepo — sem precedente de build/Docker a copiar; o setup
foi desenhado do zero (ver `Dockerfile`/`docker-compose.yml`).

**Convenção de idioma**: todo código (identificadores, arquivos, pastas,
rotas) é em inglês (`src/app/sales/`, `Store`, `useGetStoresQuery`, etc.).
Texto de UI (labels, títulos, badges) fica em português, já que o público
do painel é a operação do Agiliz.AI no Brasil — mesma convenção do
`site`.

## Estrutura

- `src/app/` — App Router. `layout.tsx` monta `Providers` (Redux) +
  `SidebarProvider`/`AppSidebar`/`SidebarInset`. Uma rota por módulo:
  `/`, `/sales`, `/finance`, `/supply`, `/inventory`, `/products`,
  `/stores`.
- `src/components/app-sidebar.tsx` — navegação lateral (shadcn
  `sidebar.tsx`), item ativo destacado com `.brand-gradient`.
- `src/components/page-header.tsx` — título + descrição + slot de ações,
  reusado em todas as páginas de módulo.
- `src/components/ui/` — componentes shadcn vendorizados via CLI
  (`components.json` real, diferente do export bruto do `site`).
  Regenerados via `npx shadcn@latest add`; não editar manualmente
  arquivos que a CLI reescreve.
- `src/lib/api/` — um `createApi` (RTK Query) por domínio
  (`stores`, `products`, `inventory`, `sales`, `finance`, `supply`),
  todos usando `base-query.ts` (`mockBaseQuery`) em vez de
  `fetchBaseQuery`.
- `src/mocks/` — fixtures em memória por domínio (15-30 registros cada),
  fonte de dados do `mockBaseQuery`.
- `src/lib/store.ts` / `src/lib/hooks.ts` — `configureStore` com os 6
  reducers de API e hooks tipados `useAppDispatch`/`useAppSelector`.
- `src/styles` — tokens de marca vivem direto em `src/app/globals.css`
  (bloco `:root, .dark`), não em um arquivo `theme.css` separado — assim
  que a CLI do shadcn v4 estrutura o CSS hoje.

## Scripts

`pnpm dev` (Turbopack) / `build` / `start` / `lint` / `typecheck`. ESLint flat
config (`next lint` foi removido no Next 16) que importa o flavour
compartilhado `eslint.frontend.mjs` da raiz. Pacote: `@agiliz/admin`, membro do
workspace pnpm — instale sempre pela raiz.

## Docker

`Dockerfile` multi-stage (`base → dev → build → prod`). O estágio `prod`
roda `node server.js` a partir de `.next/standalone` (não nginx — Next
precisa de um servidor Node em runtime, diferente do `site` estático).

**Gotcha resolvido**: o `server.js` do modo standalone lê `process.env.HOSTNAME`
como endereço de bind; o Docker seta `HOSTNAME` automaticamente para o ID
do container, então sem `ENV HOSTNAME=0.0.0.0` no Dockerfile o servidor
só escuta no IP do container, não em loopback — quebra o healthcheck.
Além disso, o `wget` do Alpine resolve `localhost` para `::1` primeiro
(Next só escuta em IPv4), por isso o healthcheck do `docker-compose.yml`
usa `http://127.0.0.1:3000` explicitamente, não `localhost`.

**Gotcha do monorepo**: com pnpm workspace, o build roda com a **raiz do repo**
como contexto (`context: ../../..`) e o output standalone preserva a forma do
workspace — `server.js` fica em `.next/standalone/frontend/apps/admin/`, e seus
`node_modules` são symlinks apontando para o store virtual pnpm na raiz do
bundle. Por isso o Dockerfile copia a árvore inteira e roda
`node frontend/apps/admin/server.js`: achatar quebra todos os symlinks e o
servidor morre com "Cannot find module 'next'". `outputFileTracingRoot` no
`next.config.ts` fixa essa forma.

`docker-compose.yml`: serviços `admin-dev` (porta `3000`) e `admin-prod`
(porta `8080:3000`) na rede externa `agiliz_network`. Registrado no
`agiliz-cli` (ver [../../../cli/CLAUDE.md](../../../cli/CLAUDE.md)).

## Gaps conhecidos

- Sem backend real: todas as 6 APIs usam `mockBaseQuery` sobre fixtures
  em memória. Trocar por `fetchBaseQuery` quando `backend/apps` ganhar um
  serviço de domínio (hoje `backend/apps/` está vazio).
- Sem autenticação/login — decisão explícita para esta primeira versão,
  o app abre direto no dashboard.
- Páginas de módulo são só listagem (tabela + filtro básico); sem
  create/edit/delete ainda — por isso o componente `form` do shadcn não
  foi instalado.
- `frontend/common/` continua vazio; este app não compartilha nada com o
  `site` ainda (nenhum ganho óbvio de baixo risco identificado).
