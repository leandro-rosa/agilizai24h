# BRAND.md — tokens canônicos Agiliz.AI

Extraído do Manual de Identidade Visual v1.0 (2025), em
[`manual-da-marca/`](manual-da-marca/). Esta é a fonte de verdade de cor e
tipografia para todos os frontends. Os `DESIGN.md` de cada app descrevem só
o que é específico daquele app — não redeclaram paleta.

## Paleta primária (prancha 02)

| Nome | Hex | Papel |
|---|---|---|
| Magenta Framboesa | `#8E1D4D` | A Assinatura Evoluída — cor primária de marca |
| Vermelho Tomate | `#E10600` | Apetite & Ação — acento, nunca ação primária |
| Carvão | `#1F1F1F` | A Base Urbana — fundo do tema escuro |
| Creme Quente | `#FFF4E6` | A Luz — fundo do tema claro |

## Elementos gráficos (prancha 07)

- Magenta de ícones e destaque digital: `#E91E8C`.
- Gradiente principal: `#E91E8C` → `#5B2D8E`. O roxo é **amostrado da barra
  do manual**, não lido de um arquivo — é o único valor desta página que não
  vem escrito. Substituir pelo valor real quando houver vetor.
- Ícones **sempre em linha, nunca preenchidos**.
- Padrões (dots, ondas) sempre com opacidade reduzida.

## Tipografia (prancha 03)

Montserrat. Bold (700) títulos · SemiBold (600) subtítulos · Regular (400)
corpo. Fallback declarado pelo próprio manual: Inter.

## Usos proibidos (prancha 05)

Não alterar cores do logotipo, não distorcer, não rotacionar, não adicionar
efeitos/sombra, não usar em baixo contraste, não alterar proporções. Área de
proteção = altura do símbolo "a" em todos os lados (prancha 04).

## Tom de voz (prancha 08)

Ágil · Inteligente · Acessível · Profissional. Linguagem direta e objetiva,
benefícios práticos, profissional mas acessível. Evitar jargão técnico
excessivo, informalidade demais e promessa vaga.

Taglines oficiais: "Sua rotina é rápida. A gente também." · "Rápido, fácil e
sem espera: Agiliza aqui!" · "Feito para quem não tem tempo a perder."
(a terceira não está nas pranchas — vem do lockup
`logo/Logo Horizontal com Frase (1).psd`).

## Arquivos de logotipo (`manual-da-marca/logo/`)

| Arquivo | Conteúdo | Fundo | Serve para |
|---|---|---|---|
| `Logo Vertical.png` (2480×3508) | símbolo em gradiente + wordmark **branco**, empilhados | transparente | só fundo escuro |
| `Logo Horizontal (1).psd` (3492×2673) | símbolo + wordmark **branco**, lado a lado | carvão chapado `#1B1C1C`, sem alfa | só fundo escuro |
| `Logo Horizontal com Frase (1).psd` | idem + tagline | carvão chapado | só fundo escuro |
| `A Logo Escuro.pdf` (A4, 300dpi) | **só o símbolo**, sólido carvão | branco | fundo claro |
| `A logo.pdf` | **0 bytes — arquivo quebrado** | — | nada |

**Buraco no kit:** não existe wordmark para fundo claro — nem em cor, nem em
carvão. O símbolo em gradiente é o único elemento que funciona nos dois
temas (magenta/roxo tem contraste tanto sobre creme quanto sobre carvão), e
é justamente a versão que a prancha 09 manda usar em espaço pequeno. Pedir à
autora da marca: lockup horizontal para fundo claro, `A logo.pdf` de novo, e
os vetores (`.svg`/`.ai`) de tudo.

## Onde isto vira código

`frontend/apps/admin/src/app/globals.css` — bloco `:root` (tema claro) e
`.dark` (tema escuro). O `apps/site` ainda usa os tokens genéricos do shadcn
em `src/styles/theme.css`; migrar é trabalho à parte (ver
[apps/site/CLAUDE.md](../apps/site/CLAUDE.md)).
