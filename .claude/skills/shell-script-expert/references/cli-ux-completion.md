# UX de CLI e Completion

Use esta referencia para qualquer script executavel diretamente por pessoas,
CI ou outra ferramenta.

## Contrato de streams

- stdout contem o resultado primario e dados destinados a composicao.
- stderr contem progresso, avisos, diagnosticos e prompts.
- `--quiet` reduz mensagens auxiliares, mas nao esconde erros.
- `--verbose` e `--debug` aumentam detalhe sem alterar o resultado primario.
- Ofereca `--json` somente quando puder produzir JSON valido e estavel. Nunca
  misture logs no stream JSON.

Detecte TTY por stream. stdout pode estar redirecionado enquanto stderr ainda
esta em um terminal. Cores e progresso devem considerar o stream em que serao
escritos.

## Ajuda e erros

A ajuda deve conter:

1. descricao em uma frase;
2. sintaxe de uso;
3. subcomandos e opcoes;
4. defaults e variaveis de ambiente relevantes;
5. exemplos copiaveis;
6. codigos de saida relevantes;
7. forma de obter mais ajuda.

`-h` e `--help` retornam zero. Argumentos invalidos retornam codigo diferente
de zero e mostram um resumo curto com a sugestao de `--help`, sem despejar uma
pagina completa por padrao.

Mensagens de erro devem identificar a entrada ou recurso, explicar a restricao
e sugerir uma acao segura. Nao exponha stack traces ou detalhes internos sem
modo debug.

## Interatividade sem bloquear automacao

- Leia do usuario apenas quando `[[ -t 0 ]]` e o modo interativo estiver
  habilitado.
- `--no-input` proibe qualquer prompt. Se faltar dado, falhe indicando a flag
  necessaria.
- Permita que todo valor solicitado tambem seja fornecido de forma nao
  interativa.
- Leia com `IFS= read -r`. Para segredo, desabilite echo de forma segura e
  restaure o terminal mesmo em falha.
- Aceite Ctrl-C e limpe recursos sem converter cancelamento em sucesso.
- Em confirmacoes perigosas, mostre exatamente o que sera alterado.
- Para risco severo, exija digitar um identificador ou passar
  `--confirm IDENTIFICADOR`; um simples `y` pode ser insuficiente.

## Dry-run e idempotencia

Um dry-run deve seguir validacao e planejamento reais, omitindo apenas o efeito
colateral. Marque claramente cada acao simulada. Nao diga que a operacao foi
concluida.

Operacoes idempotentes devem distinguir estado ja desejado de erro. Informe ao
usuario quando nada precisou ser alterado.

## Cores e terminal

Desabilite cores quando:

- o stream relevante nao for TTY;
- `NO_COLOR` estiver definido e nao vazio;
- `TERM=dumb`;
- `--no-color` for informado.

Nao dependa apenas de cor para comunicar estado. Evite animacoes em logs,
pipelines e CI. Use texto ASCII por padrao quando o ambiente nao garantir
Unicode.

## Projeto de completion

Liste a gramatica da CLI antes de implementar completion:

- flags globais;
- subcomandos;
- flags por subcomando;
- argumentos posicionais;
- valores enumerados;
- arquivos e diretorios;
- repetibilidade e exclusao mutua.

No Bash, use `COMP_WORDS`, `COMP_CWORD`, `COMPREPLY`, `compgen` e `complete`.
Evite analisar novamente a linha como codigo e nunca use `eval` com entrada da
linha de comando.

Completion deve ser:

- contextual, sugerindo apenas valores validos para a posicao atual;
- rapido, sem rede ou scans ilimitados;
- livre de efeitos colaterais;
- tolerante a argumentos parciais;
- sincronizado com parser e ajuda;
- testado por smoke test que carrega o arquivo e verifica a funcao registrada.

Para uma ferramenta distribuida, prefira:

```text
ferramenta completion bash
```

Ativacao temporaria:

```bash
source <(ferramenta completion bash)
```

Instalacao persistente depende do sistema e deve ser documentada sem editar
arquivos de inicializacao do usuario automaticamente.

## Acessibilidade e previsibilidade

- Nao exija mouse, terminal grafico ou largura fixa.
- Mantenha prompts curtos e defaults explicitos.
- Nao use contagens regressivas para consentimento.
- Nao corrija silenciosamente uma entrada destrutiva; sugira a correcao.
- Mostre o proximo comando util quando houver uma sequencia de trabalho.

## Fonte de UX

- Command Line Interface Guidelines: https://clig.dev/
