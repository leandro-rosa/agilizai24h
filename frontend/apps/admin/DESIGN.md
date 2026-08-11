# DESIGN.md — frontend/apps/admin

Identidade visual compartilhada com o site institucional — ver
[`../site/DESIGN.md`](../site/DESIGN.md) para a fonte da paleta,
tipografia e tom de marca (gradiente magenta/pink → roxo, fundo dark
zinc-950, acento vermelho/laranja com moderação, Inter/SF Pro). Este
documento cobre só o que é específico do painel administrativo.

## Diferença de propósito

O `site` é institucional/marketing, voltado a clientes em potencial
(empresas e condomínios). O `admin` é uma ferramenta interna de operação
— tom mais funcional/denso que o site, mas sem perder a identidade de
marca (gradiente como acento, nunca decorativo em excesso).

## Tokens de marca (aplicados, não só documentados)

Diferente do `site` (onde os tokens de `theme.css` ainda são o padrão
genérico do shadcn — gap documentado), o `admin` já nasce com os tokens
de marca aplicados em `src/app/globals.css`:

- `--primary`: pink-500 sólido (gradiente não cabe em custom property
  CSS — usar utilitário `.brand-gradient`/`.brand-gradient-text` para o
  gradiente completo pink→purple).
- `--radius`: `0.875rem` (~14px), dentro do alvo 12-16px do DESIGN.md do
  site (vs. os 10px atuais do `site`).
- `--warning`: laranja, token novo (não existe no `site`) para alertas de
  estoque abaixo do mínimo e solicitações de abastecimento pendentes.
- Dark-only nesta v1 — `:root` e `.dark` carregam os mesmos valores, sem
  toggle de tema.

## Layout

Shell com sidebar fixa à esquerda (componente `sidebar.tsx` do shadcn,
colapsável para ícones) + header com breadcrumb/trigger, em vez do
header sticky horizontal do site. Item de navegação ativo destacado com
borda + fundo sutil em `.brand-gradient`, não preenchimento sólido —
mesmo princípio do site de "gradiente como acento, não em tudo".

## Padrões de tela

- **Listagem**: `PageHeader` (título + descrição) → linha de filtros
  (busca em `Input` + `Select`) → `Table` shadcn. Enquanto carrega,
  `Skeleton` no lugar das linhas (RTK Query mock simula latência).
- **Status/badges**: cores semânticas via os tokens do tema — `secondary`
  para estados neutros/positivos (ativa, concluído), `--warning` para
  atenção (manutenção, pendente, estoque próximo do mínimo),
  `destructive` para crítico (inativa, abaixo do mínimo). Nunca cor
  Tailwind solta (`orange-500` etc.) — sempre os tokens do tema.
- **KPIs**: `Card` com `CardTitle` pequeno em `text-muted-foreground` +
  valor grande em `text-2xl font-semibold` — usado no dashboard e na
  página Financeiro.

## Fora de escopo nesta v1

Sem tela de login, sem formulários de criação/edição (só listagem),
sem toggle de tema claro/escuro.
