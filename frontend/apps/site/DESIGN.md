# DESIGN.md — frontend/apps/site

Sistema de design do site institucional do Agiliz.AI. Fontes: brief
original em
[`src/imports/pasted_text/agiliz-ai-marketing-site.md`](src/imports/pasted_text/agiliz-ai-marketing-site.md),
logo (`src/assets/logo-color-text.png`) e fotos reais das instalações
(`src/assets/store-*.jpeg`). Ver [CLAUDE.md](CLAUDE.md) para o estado
técnico dos tokens hoje.

## Identidade

Mercado autônomo 24h instalado dentro de empresas e condomínios. Estilo
"SaaS premium + retail" — deve parecer uma startup de tecnologia séria, não
um mercadinho genérico. Sensação-alvo: premium, rápido, sem fricção,
tech-enabled, ao mesmo tempo próximo do dia a dia de quem usa.

Frases de marca (usar como destaques, banners, microcopy — não só no
brief, repetir pela UI):

- "Sua vida não para. Aqui, nem a gente."
- "É só pegar, pagar e seguir o dia."
- "Comida de verdade, sem perder tempo."

## Cor

Primário: gradiente magenta/pink → roxo. Confirmado tanto pelo logo
(gradiente roxo→vermelho com um ponto vermelho sólido de destaque) quanto
pelas fotos reais das lojas (geladeiras e totens com wrap em gradiente
magenta-pink sobre fundo de madeira escura). Já em uso ad hoc no código
como `pink-500` → `purple-600` (Tailwind) nos CTAs e destaques de
navegação.

- **Fundo**: escuro, modo dark preferencial (`zinc-950`/`zinc-800` já em
  uso).
- **Acento secundário**: vermelho/laranja (do ponto do logo) — usar com
  moderação, não compete com o gradiente pink→purple como cor de ação
  primária.
- **Texto sobre fundo escuro**: branco + cinza claro para texto
  secundário.

**Gap conhecido**: os tokens em `theme.css` (`--primary: #030213`, OKLCH
neutros padrão do shadcn) não refletem essa paleta — a cor de marca está
hardcoded em classes soltas no `Header`/`Footer`, não centralizada. Este
documento define o alvo; migrar os tokens de `theme.css` para a paleta de
marca é trabalho futuro, fora deste documento.

## Tipografia

Sans-serif moderna, estilo Inter/SF Pro. `src/styles/fonts.css` está
vazio hoje — nenhuma fonte customizada carregada (gap conhecido, ver
[CLAUDE.md](CLAUDE.md)).

## Forma e espaçamento

- Cantos arredondados generosos: 12–16px (o token atual `--radius:
  0.625rem` ≈ 10px está perto, mas abaixo do alvo).
- Sombras suaves, nunca duras.
- Espaçamento generoso entre seções ("breathing layout") — evitar
  densidade, cada seção deve respirar.

## Componentes

O inventário shadcn/ui já presente em `src/app/components/ui/` (accordion,
alert-dialog, avatar, button, card, carousel, dialog, drawer,
dropdown-menu, form, input, select, sheet, tabs, tooltip etc.) é a base de
reuso — não recriar variantes equivalentes. Cards com hover effect são o
padrão para blocos de seleção (ex.: "Empresas" vs "Condomínios" na Home).

## Estrutura de páginas

Home, Empresas, Condomínios, Produtos, Sobre, Contato — todas sob um
header sticky com navegação + CTA de proposta, e footer com marca/links/
contato.

- **Home**: hero (título + subtítulo + 2 CTAs, imagem de fundo com
  overlay gradiente) → seleção de segmento (2 cards grandes: Empresas /
  Condomínios) → "o que é Agiliz" → diferencial (comida de verdade vs.
  industrializado) → como funciona (3 passos) → benefícios → prova social
  (grid/carrossel com fotos reais) → CTA final (WhatsApp + solicitar
  proposta).
- **Empresas**: tom B2B, foco em produtividade — hero, dores, solução,
  benefícios, diferenciação de comida, facilidade de implantação, CTA.
- **Condomínios**: tom lifestyle/prático, foco em conveniência e
  valorização — hero, dores do síndico, solução, benefícios, experiência,
  como funciona, CTA.
- **Produtos**: categorias em grid de cards (refeições prontas, lanches,
  bebidas, essenciais).
- **Sobre**: missão, posicionamento, ângulo de estilo de vida moderno.
- **Contato**: formulário (nome, telefone, tipo empresa/condomínio,
  mensagem) + CTA principal para WhatsApp.

## Uso de imagem

Fotos reais das instalações (não fotos de banco de imagens genéricas) —
usar como fundo de hero (com overlay gradiente para legibilidade) e em
prova social. Devem transmitir: instalação real, autonomia, ambiente
moderno, máquinas com a marca (pink) visível. Hoje há 2 fotos em
`src/assets/` (`store-1.jpeg`, `store-2.jpeg`).

## UX

Header sticky, scroll suave, hover states em cards, hierarquia clara de
CTA (primário vs. secundário), mobile-first.
