# DESIGN.md — frontend/apps/admin

Cor e tipografia vêm de [`../../docs/BRAND.md`](../../docs/BRAND.md),
extraído do manual da marca — este documento não redeclara paleta, cobre só
o que é específico do painel. Ver [CLAUDE.md](CLAUDE.md) para o estado
técnico.

## Diferença de propósito

O `site` é institucional/marketing, voltado a clientes em potencial. O
`admin` é ferramenta interna de operação — tom mais funcional e denso, sem
perder a identidade. A marca aqui aparece na cor, na tipografia, no
símbolo e num padrão de fundo sutil de linha fina (`.brand-canvas`, ver
abaixo) — nunca em ornamento denso que compita com dado. A opacidade baixa
e o traço fino são o que fazem a diferença entre as duas coisas, e são
regra do próprio manual (prancha 07).

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
| `symbol-white` | símbolo sólido branco | sidebar e `/login`, sobre `.brand-sidebar`/`.brand-surface` |
| `symbol` | símbolo em gradiente | sem uso hoje — reservado pra fundo neutro (creme/carvão) |
| `lockup` | símbolo em gradiente + wordmark branco, um PNG só | sem uso hoje — só serve sobre painel escuro sólido |
| `ink` | símbolo monocromático carvão | sem uso hoje — reservado pra fundo claro sólido |

**Gradiente não sobrevive em cima de gradiente**: o símbolo `symbol`
(magenta→roxo) some contra `.brand-sidebar`/`.brand-surface`, que já são
magenta→roxo — foi o pedido explícito que trocou o chrome (sidebar + logo
do `/login`) para `symbol-white`, um recorte próprio
(`public/brand/symbol-white.png`) sem equivalente no kit entregue: gerado
de `symbol-ink.png` (o silhueta monocromática já vendorizada) recolorindo
preto→branco com alpha preservado — não é "alterar a cor da marca" na
acepção proibida da prancha 05, é reproduzir o uso que a própria contracapa
do manual já faz (símbolo sólido branco sobre o gradiente).

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

### `.brand-canvas`

`public/brand/contour.svg` — um contorno topográfico orgânico (linhas
finas, vários centros de espiral, cobrindo o quadro inteiro), a peça que
efetivamente bate com a contracapa do manual
(`../../docs/manual-da-marca/`). **Não é desenho à mão**: é gerado —
somar algumas gaussianas 2D num campo escalar e extrair curvas de nível
dele (marching squares) produz exatamente esse tipo de linha orgânica
interferindo consigo mesma, sem precisar acertar a mão numa forma de onda
"parecida". `stroke` é `--brand-magenta` (mesmo hex nos dois temas — só
`--background` muda), `stroke-opacity` 0.20, um único arquivo para claro e
escuro. `scripts/generate-contour-pattern.py` (`numpy` só) reproduz os dois
SVGs byte a byte — mexer no padrão é mudar os parâmetros ali e rodar de
novo, nunca editar o `.svg` à mão.

**Duas tentativas anteriores não bateram com a imagem de referência** — a
primeira ("posição estranha") e a segunda ("mais predominância, menos
bege") eram blobs sólidos translúcidos ancorados num canto, não o
contorno de linha fina do manual; o usuário apontou de volta pro mesmo
arquivo de referência ("nem sequer se parece") até a arte em si mudar, não
só opacidade/posição. Fica registrado porque é fácil recair no mesmo erro
mexendo de novo nisso: **o que faz parecer com o manual é o traço fino
cobrindo o quadro inteiro, não opacidade alta numa forma grande**.

`background-size: cover` + `background-position: center` esticam o mesmo
1400×800 pra qualquer proporção de caixa — é o que permite reusar o
arquivo tanto no `body` inteiro quanto espremido nos 56px do header
(mostra só uma fatia horizontal fina, e uma fatia de linha não corta feio
como um blob cortava — foi exatamente o bug da segunda tentativa).

**Retirado das rotas autenticadas** (`body` em `app/layout.tsx`,
`SidebarInset` em `(app)/layout.tsx`, e junto o `bg-primary/10` do
`<header>` que existia só pra tingir a faixa onde a linha não alcançava) —
pedido explícito do operador vendo o painel em uso real: o traço, mesmo
fino/opaco 0.20, atrapalhava a leitura de tabela/card densos ("esses
riscos atuais estão feios e impedindo de ler algumas coisas"). A classe
`.brand-canvas` continua existindo (ainda usada no `main` de `/login`, ver
abaixo) — só parou de ser aplicada nas telas de operação, que agora têm
`bg-background` sólido sem imagem por cima. Não reaplicar em `body`/
`SidebarInset` sem confirmar de novo com o operador, mesmo que pareça
"corrigir" pra bater com o manual — a legibilidade em uso real venceu a
fidelidade à peça de marca aqui.

`.brand-surface` usa `contour-surface.svg` (mesma geometria, stroke creme
translúcido em vez de magenta — a versão magenta se perderia por já estar
na mesma família de cor do gradiente escuro), também `cover`/`center`, uma
segunda camada de `background-image` por cima do gradiente sólido — é a
dupla gradiente+contorno da contracapa do manual, agora fiel de verdade.

O `<header>` das rotas autenticadas soma `bg-primary/10` (Tailwind, mesma
ordem de grandeza de `--accent`/`--secondary`, tokens já verificados por
`pnpm contrast`) ao `.brand-canvas` pra tingir a largura inteira, não só
onde a linha passa.

### `.brand-sidebar`

A régua lateral inteira (não só header/footer, tentativa anterior) usa a
mesma superfície de `.brand-surface` — gradiente + `contour-surface.svg`,
**igual nos dois temas**, pedido explícito ("no menu do tema claro não
pode ficar com a cor preta, pois fica ruim pra ver com o background
rosa"). 240px de largura continua estreito demais pro desenho de 1400×800
não virar rabisco, mas aqui não precisa: é a MESMA superfície de
`.brand-surface`, que já é full-bleed/`cover`, então o corte fica igual ao
do painel do `/login` — a régua lê como uma fatia vertical dessa mesma
peça, não um desenho encolhido pra caber.

**Mecanismo**: `className` em `<Sidebar>` (`app-sidebar.tsx`) cai no
`sidebar-container` de `ui/sidebar.tsx` — ancestral de `sidebar-inner`
(quem pinta `bg-sidebar`, sem prop de `className` própria, então não dá
pra pintar o gradiente direto nele sem editar o arquivo vendorizado pela
CLI). `.brand-sidebar` zera `--sidebar` (deixa `bg-sidebar` transparente,
revelando o gradiente pintado um nível acima) e redefine todos os outros
`--sidebar-*` pro mesmo valor nos dois temas — é cascata puro-CSS: toda
classe já usada em `app-sidebar.tsx` (`bg-sidebar-accent`,
`text-sidebar-foreground`, `border-l-sidebar-primary`) passa a resolver
contra esses valores fixos sem precisar trocar uma linha de className por
tema. Os valores de `:root`/`.dark` (framboesa sobre branco no claro,
magenta sobre carvão no escuro) não sobrevivem — é exatamente o texto
quase-preto do tema claro (`--sidebar-foreground: #1f1f1f`) contra o
gradiente magenta que motivou a mudança.

`SidebarHeader`/`SidebarFooter` perderam o `bg-primary/10`/
`border-t-primary` da tentativa anterior — eram um substituto pra dar
presença de marca a uma régua que ainda era `bg-sidebar` sólida; com a
régua inteira já sendo o gradiente, uma faixa extra ali só criaria uma
costura visível. `SidebarFooter` ficou só com `border-t border-t-sidebar-border`
(fio translúcido branco, não a borda opaca do token base) pra separar
navegação de conta+tema sem cortar o gradiente.

**Gotcha de SVG-como-imagem que já mordeu duas vezes**: um SVG servido
sem `charset` no `Content-Type` (`image/svg+xml` puro, o que `next dev`/
`next start` mandam pra `public/`) só é interpretado como UTF-8 de forma
confiável quando ele mesmo declara `<?xml version="1.0"
encoding="UTF-8"?>` — sem essa linha, um comentário com acento quebra o
parse **só** no contexto de imagem (`background-image`/`<img>`, que exige
XML bem-formado), nunca inline nem via `fetch().text()`, o que torna o bug
enganoso (parece "não funciona como background-image", mas é o comentário
acentuado antes dele que derruba o arquivo). E mesmo com a declaração, um
comentário XML não pode conter `--` — `--background` escrito literal num
comentário já quebra de novo. As duas pontas (declaração UTF-8 no topo,
zero `--` duplo em comentário) valem pra qualquer `.svg` novo nesta pasta.

Nunca aplicado em `--card`/`--sidebar` (a régua lateral, `bg-sidebar` em
`ui/sidebar.tsx`): essas superfícies continuam sólidas de propósito, é o
que preserva legibilidade de tabela/formulário densos.

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
