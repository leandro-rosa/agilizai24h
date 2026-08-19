# frontend/apps/admin

Painel de gestão interno do Agiliz.AI — vendas, financeiro, abastecimento,
estoque, produtos e lojas. Hoje essa gestão é feita no sistema terceiro
touchpay; este app é o novo front de gestão. Fala **só** com
`gateway-service`, autenticado, sobre dado real — ver
[../../CLAUDE.md](../../CLAUDE.md) para convenções do workspace frontend e
[DESIGN.md](DESIGN.md) para identidade visual/marca.

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

- `src/app/layout.tsx` — só chrome global (`Providers`/Redux, tooltip,
  toaster). Não monta sidebar nenhuma — `/login` e as rotas de gestão
  precisam de shells diferentes.
- `src/app/login/page.tsx` — rota pública, formulário de e-mail/senha
  (`react-hook-form` + `zod`).
- `src/app/(app)/` — route group que concentra toda rota autenticada
  (`/`, `/sales`, `/finance`, `/supply`, `/inventory`, `/products`,
  `/stores`). `(app)/layout.tsx` é quem monta `AuthGate` +
  `SidebarProvider`/`AppSidebar`/`SidebarInset` — um group novo nasce
  protegido só por estar dentro dessa pasta.
- `src/components/auth-gate.tsx` — chama `GET /auth/me`; segura a
  renderização (skeleton) até ter identidade. Um 401 é tratado **fora**
  daqui, globalmente, em `gatewayBaseQuery`.
- `src/components/request-state.tsx` — o único lugar que decide
  loading/vazio/erro/sem-permissão; toda tela com dado passa por ele em
  vez de reescrever o próprio `if (isLoading)`.
- `src/components/store-period-picker.tsx` — seletor de loja+mês
  compartilhado por vendas/abastecimento/estoque/financeiro: nenhum dos
  quatro tem endpoint "rede inteira", todos são por loja e período.
- `src/components/app-sidebar.tsx` — navegação lateral (shadcn
  `sidebar.tsx`), item ativo destacado com `.brand-gradient`; rodapé tem
  identidade do operador (`GET /auth/me`) + logout.
- `src/components/page-header.tsx` — título + descrição + slot de ações,
  reusado em todas as páginas de módulo.
- `src/components/ui/` — componentes shadcn vendorizados via CLI
  (`components.json` real, diferente do export bruto do `site`).
  Regenerados via `npx shadcn@latest add`; não editar manualmente
  arquivos que a CLI reescreve. Exceção: `form.tsx` foi escrito à mão —
  ver Gaps conhecidos.
- `src/lib/api/base-query.ts` — `gatewayBaseQuery`: `fetchBaseQuery`
  (`credentials: "include"`, `baseUrl` de `NEXT_PUBLIC_GATEWAY_URL`)
  envolto em `retry()`. 401 → navegação completa para `/login` (nunca
  client-side — o cache do RTK Query da sessão anterior não pode
  sobreviver). 403 passa intocado (nunca desloga). 503 é o único status
  que tenta de novo, via `retry.fail` em todo o resto.
- `src/lib/api/` — um `createApi` por domínio (`auth`, `stores`,
  `products`, `sales`, `supply`, `inventory`, `finance`, `overview`),
  todos sobre `gatewayBaseQuery`, cada um contra a rota real do gateway.
- `src/lib/auth/use-permission.ts` — `useHasPermission(permission)`,
  reaproveita o cache de `getMe`; é cortesia de UX, nunca a fronteira de
  segurança (o gateway continua validando e pode devolver 403 mesmo para
  uma ação que este hook disse estar disponível).
- `src/lib/removal-reasons.ts` — rótulos PT dos 6 motivos de remoção,
  espelhando (não substituindo) a tabela autoritativa em
  `supply-service`.
- `src/lib/store.ts` / `src/lib/hooks.ts` — `configureStore` com os 8
  reducers de API e hooks tipados `useAppDispatch`/`useAppSelector`.
- `src/styles` — tokens de marca vivem direto em `src/app/globals.css`
  (bloco `:root, .dark`), não em um arquivo `theme.css` separado — assim
  que a CLI do shadcn v4 estrutura o CSS hoje.

## Vendas, abastecimento, estoque e financeiro são por loja+mês

Nenhum dos quatro tem endpoint "rede inteira" no backend — cada um é
`GET /<dominio>/:storeId?period=`. `/sales` e `/supply` devolvem **404**
(não lista vazia) para uma loja+mês nunca ingerido — tratado como estado
vazio próprio (`RequestState`), distinto de um erro real. A visão geral
(`/`) por isso só soma o que é de fato agregável na rede —
`GET /overview` (lojas + produtos) — e não fabrica um "vendas hoje" ou
"abastecimentos pendentes" de rede inteira que o backend não tem como
responder honestamente.

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

**`NEXT_PUBLIC_GATEWAY_URL`** — a única env var deste app, lida no
browser (RTK Query roda client-side). Next não tem runtime env
client-side: `next build` embute o valor no bundle. Por isso
`admin-prod` recebe como **build arg** (`docker-compose.yml`'s
`build.args`, não `environment:` — settar como `environment:` não teria
efeito nenhum no build já compilado), enquanto `admin-dev` recebe como
`environment:` normal mesmo (o `next dev` recompila a cada request).
Default `http://localhost:3080`, o `GATEWAY_HOST_PORT` padrão. Ver
também `ADMIN_ORIGIN` em
[gateway-service/CLAUDE.md](../../../backend/apps/gateway-service/CLAUDE.md)
— o painel e o gateway são origens diferentes mesmo em dev (portas
diferentes em localhost), então CORS-com-credenciais nos dois lados é o
que faz a sessão funcionar.

## Gaps conhecidos

- **CLI do shadcn não instala `form` no registry `radix-nova`** — o item
  existe no registry mas devolve um JSON vazio (`{"name":"form","type":"registry:ui"}`,
  sem `files`), então `npx shadcn@latest add form` roda com exit 0 e não
  instala nada. `form.tsx` foi escrito à mão, seguindo os componentes já
  vendorizados (import unificado `radix-ui`, `cn`, mesma estrutura de
  props) — se um dia o registry ganhar o conteúdo real, comparar antes
  de sobrescrever.
- **`useHasPermission` existe mas nada o usa ainda.** Nenhuma tela tem
  ação de escrita na UI (o `PUT /inventory/:sku/minimum` tem mutation
  pronta, `useSetMinimumMutation`, mas nenhum botão a chama). O
  mecanismo de esconder ação por permissão está pronto, mas sem ação
  real para testar contra.
- **Upload das três planilhas ainda não tem tela.** `POST /ingestions`
  do gateway já existe (`ingestion-worker-service`); falta a UI de
  upload, lista de ingestões e detalhe com linhas rejeitadas.
- **Sem suíte de testes automatizados no app** — a verificação até agora
  foi manual, ao vivo, contra o stack real via browser automation (login,
  dashboard, vendas, financeiro, estoque, todos com dado real de
  produção). Nenhum teste unitário/integração do painel existe ainda.
- `frontend/common/` continua vazio; este app não compartilha nada com o
  `site` ainda (nenhum ganho óbvio de baixo risco identificado).
