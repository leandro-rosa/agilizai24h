# DESIGN.md — frontend/apps/admin

Cor e tipografia vêm de [`../../docs/BRAND.md`](../../docs/BRAND.md),
extraído do manual da marca — este documento não redeclara paleta, cobre só
o que é específico do painel. Ver [CLAUDE.md](CLAUDE.md) para o estado
técnico.

## Diferença de propósito

O `site` é institucional/marketing, voltado a clientes em potencial. O
`admin` é ferramenta interna de operação — tom mais funcional e denso, sem
perder a identidade. A marca aqui aparece na cor, na tipografia e no
símbolo; não em ornamento.

## Dois temas, padrão do sistema operacional

`next-themes` com `attribute="class"`, `defaultTheme="system"`. O operador
escolhe Claro/Escuro/Sistema pelo `ThemeToggle` no rodapé da sidebar, e a
escolha explícita sobrevive em `localStorage`. `:root` carrega o tema claro
e `.dark` o escuro, em `src/app/globals.css`.

Três tokens mudam de valor entre os temas, e cada um tem motivo:

| Token | Claro | Escuro | Por quê |
|---|---|---|---|
| `--primary` | `#8E1D4D` Magenta Framboesa | `#E91E8C` magenta | Ambas são cores do manual. A framboesa sobre carvão dá ~2,1:1 e reprovaria; o magenta é justamente a cor que o manual designa para destaque digital (prancha 07). |
| `--primary-foreground` | `#FFF4E6` | `#0D0D0D` | Sobre o magenta, carvão `#1F1F1F` dá 3,95:1 e reprova para texto. Escurecer o rótulo chega a 4,65:1 **sem tocar na cor do manual** — a correção é sempre no derivado. |
| `--destructive` | `#E10600` Vermelho Tomate | `#FF5449` | O tomate puro sobre o card escuro dá 4,19:1. |

## Acessibilidade é verificada, não presumida

`pnpm contrast` (`scripts/contrast.mjs`) roda 20 pares e sai != 0 se algum
reprovar. Ele separa os dois limiares da WCAG, que não são intercambiáveis:

- **4,5:1** para texto (1.4.3);
- **3:1** para o que identifica um controle — anel de foco, borda de campo
  (1.4.11). Borda decorativa e divisória **não** caem nessa regra e podem
  ser sutis; por isso `--input` é mais forte que `--border`.

Ao mexer em token, rodar antes de commitar. Se reprovar, ajustar o token
derivado — nunca as quatro cores do manual.

## Tipografia

Montserrat via `next/font/google`, pesos 400/600/700 (o manual usa
exatamente três). Fallback é Inter, declarado pelo próprio manual.

`.tabular` (`font-variant-numeric: tabular-nums`) é **obrigatório** em
número em coluna — KPI e célula de tabela. O painel é quase todo cifra
alinhada à direita, e sem isso os dígitos dançam entre linhas.

## Logotipo

`BrandMark` é o único lugar que conhece os arquivos, em `public/brand/`:

| variante | arquivo | onde |
|---|---|---|
| `symbol` | símbolo em gradiente | chrome, nos dois temas |
| `lockup` | símbolo + wordmark branco | só `/login`, sobre painel escuro |
| `ink` | símbolo monocromático carvão | onde o gradiente não couber |

**O kit não tem wordmark para fundo claro** — só a versão branca (ver a
tabela de arquivos no `BRAND.md`). Por isso o chrome usa o símbolo isolado
nos dois temas, que é o que a prancha 09 prescreve para espaço pequeno, e o
lockup completo aparece só no `/login`, onde um painel escuro fixo dá a ele
o fundo para o qual foi desenhado. Esse painel é a **única** superfície do
app com cor de marca literal (`bg-[#1f1f1f]`) em vez de token, e o
comentário no código diz por quê.

### `.brand-surface`

Gradiente profundo (roxo → framboesa), o que a prancha 07 designa para
fundo e destaque. É a superfície do painel do `/login` e **é idêntica nos
dois temas** — carvão chapado ali fundia com `--background` no escuro e
fazia o split sumir. Por ser fixa, ela carrega a própria cor de texto
(`#FFF4E6`): `text-primary-foreground` viraria `#0D0D0D` no escuro e
desapareceria.

Não confundir com `.brand-gradient`, que é o acento claro (magenta →
roxo) e não sustenta texto em cima.

Proibido pela prancha 05: recolorir, distorcer, rotacionar, aplicar sombra
ou efeito, alterar proporções. `className` no `BrandMark` serve para
posição, nunca para cor ou transform.

## Layout

Shell com sidebar fixa à esquerda (shadcn `sidebar.tsx`, colapsável para
ícones) + header com breadcrumb derivado do `nav`. Item ativo marcado com
borda à esquerda em `--primary` e fundo `--sidebar-accent` — destaque, não
preenchimento sólido.

## Padrões de tela

- **Listagem**: `PageHeader` → linha de filtros → `Table`. Enquanto carrega,
  `Skeleton` no lugar das linhas. Estado de vazio/erro/sem-permissão passa
  sempre por `RequestState`, nunca por um `if (isLoading)` reescrito.
- **Status**: `StatusBadge` com `tone` de intenção (`neutral`, `positive`,
  `attention`, `critical`) — nunca cor Tailwind solta, nunca editando
  `ui/badge.tsx`, que a CLI do shadcn reescreve.
- **KPIs**: `Card` com `CardTitle` pequeno em `text-muted-foreground` +
  valor grande em `tabular text-2xl font-semibold`.
- **Gráficos**: série sempre em `var(--chart-N)` via `ChartConfig`, nunca
  hex. Trocam de paleta com o tema sozinhos. `--chart-4`/`--chart-5` (teal,
  âmbar) são **extensão declarada de dataviz**, não cor de marca: existem
  porque as três cores da marca são todas magenta/vermelho e não se
  distinguem como séries categóricas. Proibidas em chrome de UI, e sem
  carga semântica — perda usa `--destructive`, não um slot do ramp.

### Vazio honesto

Um número que o sistema não sabe **nunca** é renderizado como `0`. Zero é
uma afirmação — "não houve" — e quase sempre a verdade é "não dá para
saber". O painel usa três formas, nesta ordem de força:

| Situação | Como aparece |
|---|---|
| Métrica indefinida por natureza (payback sem lucro, break-even sem margem) | `StatusBadge tone="critical"` "Indefinido", ou "—" com explicação abaixo |
| Dado que o backend não conseguiu responder | "Indisponível" em `--warning`, com ícone |
| Célula sem valor numa tabela | "—" em `--muted-foreground` |
| Cifra parcial (soma sobre um subconjunto) | O valor **mais** "sobre N de M", com ícone de atenção |

`RequestState` cobre os quatro estados de request (carregando, vazio, erro,
sem permissão); esta tabela é sobre a célula individual, que `RequestState`
não alcança.

## Gaps conhecidos

- **Sem wordmark para fundo claro** no kit da marca (ver acima). Pedir à
  autora, junto com os vetores.
- **`dialog.tsx`/`sheet.tsx` usam `bg-black/10` no overlay.** No tema
  escuro esse scrim quase não aparece; o que segura a separação é o
  `backdrop-blur` e o card sólido. Não corrigido de propósito: são arquivos
  reescritos pela CLI do shadcn.
- **O `.prettierrc` da raiz (aspas simples, sem `;`) não bate com o estilo
  deste app** (aspas duplas, com `;`). O admin nunca passou por
  `pnpm format`. Rodar hoje produziria um diff do app inteiro — decisão à
  parte, não dentro de uma mudança de marca.
