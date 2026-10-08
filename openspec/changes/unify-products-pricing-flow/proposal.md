## Why
A tela de Produtos e Precificação obrigava a alternar entre Catálogo e Precificação para trabalhar no mesmo produto, repetia avisos e escondia a causa de a sugestão de preço falhar. O SKU era digitado à mão e sugerido sem contador persistente.

## What Changes
- Uma lista única de produtos (custo, preço, sugerido, margem de contribuição, situação), painel "Revisar preço", novo produto simplificado, pendências agrupadas, revisão em lote e Categorias no desenho dos mockups.
- A decisão de preço usa o custo e o preço de HOJE (`GET /pricing/current`); os relatórios por período ficam em "Analisar período", com a métrica original.
- Sugestão de preço com quatro respostas (falta dado, meta inviável, ressalva, falha técnica) e descarte de respostas antigas.
- SKU automático com contador persistente (`sku_sequence`), usado por cadastro, planilha, nota e pedido.

## Out of scope
Preço por loja (o modelo guarda um preço por produto), preenchimento por prints/texto/áudio (não há integração), variante do produto, publicação no PDV, Fases B e C da precificação.
