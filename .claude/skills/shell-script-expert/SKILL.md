---
name: shell-script-expert
description: Cria, corrige, revisa e testa shell scripts Bash e CLIs .sh robustos, seguros, documentados, interativos e automatizaveis. Use sempre que o usuario mencionar shell script, shellscript, Bash, arquivo .sh, automacao de terminal, CLI, ShellCheck, shfmt, Bats, autocomplete ou completion, mesmo que ele nao solicite explicitamente esta skill.
compatibility: Claude Code e OpenCode; Bash 4+; Docker Compose opcional para ShellCheck, shfmt e Bats.
---

# Shell Script Expert

Crie scripts Bash que sejam seguros para automacao e agradaveis para uso humano.
Trate ajuda, mensagens, completions e modos nao interativos como parte da API do
script, nao como acabamento posterior.

## Fluxo de trabalho

1. Inspecione primeiro as instrucoes do repositorio, scripts semelhantes,
   versao alvo do Bash, sistema operacional e ferramentas disponiveis.
2. Confirme apenas decisoes que mudam a interface, os efeitos colaterais ou a
   compatibilidade. Nao bloqueie uma tarefa simples com perguntas evitaveis.
3. Decida se Bash e adequado. Prefira outra linguagem quando houver estruturas
   de dados complexas, concorrencia elaborada, protocolo de rede relevante ou
   logica de negocio extensa, e explique objetivamente o limite encontrado.
4. Defina antes do codigo o contrato da CLI: entradas, flags, subcomandos,
   stdout, stderr, codigos de saida, efeitos colaterais e comportamento em TTY,
   pipeline e CI.
5. Implemente a menor solucao coerente, preservando convencoes e alteracoes
   existentes.
6. Valide sintaxe, lint, formatacao, testes e fluxos de ajuda/completion.
7. Entregue um resumo curto do que mudou, comandos executados e riscos nao
   validados.

Leia `references/bash-engineering.md` ao criar ou revisar implementacoes. Leia
`references/cli-ux-completion.md` para qualquer script invocado diretamente por
usuarios, CI ou outras ferramentas.

## Contrato de implementacao

### Estrutura

- Use `#!/usr/bin/env bash` por padrao em ferramentas de projeto. Use caminho
  absoluto somente quando o ambiente de implantacao exigir.
- Declare a versao minima de Bash quando usar recursos que dependam dela.
- Considere `set -Eeuo pipefail`, mas avalie cada opcao. Nao use strict mode
  mecanicamente quando ele alterar de forma incorreta uma API existente.
- Organize scripts nao triviais em constantes, estado global minimo, funcoes e
  `main`. Termine executaveis com `main "$@"`.
- Prefira funcoes pequenas, variaveis locais e retornos antecipados.
- Use nomes `snake_case` para funcoes e variaveis locais e `UPPER_SNAKE_CASE`
  para constantes e variaveis exportadas.
- Preserve o idioma e o estilo do projeto. Em scripts novos sem convencao,
  use identificadores tecnicos claros e mensagens, ajuda e documentacao em
  portugues do Brasil.

### Documentacao obrigatoria de funcoes

Documente todas as funcoes, inclusive funcoes curtas e funcoes de completion.
Descreva o contrato, nao a sintaxe. Adapte campos sem omitir informacao
relevante:

```bash
#######################################
# Descreve o proposito e as garantias da funcao.
# Globals:
#   NOME_DA_GLOBAL ou Nenhuma
# Arguments:
#   $1 - Descricao ou Nenhum
# Outputs:
#   Descreve stdout e stderr ou Nenhuma
# Returns:
#   0 em sucesso; outros codigos e seus significados
# Side effects:
#   Arquivos, processos, rede ou Nenhum
#######################################
nome_da_funcao() {
  ...
}
```

Nao adicione comentarios que apenas repitam comandos. Documente invariantes,
riscos e decisoes que um mantenedor nao deduziria facilmente.

### Seguranca e robustez

- Coloque expansoes entre aspas, usando `"${variavel}"` e `"${array[@]}"`.
- Use arrays para argumentos de comandos. Nao monte comandos executaveis em
  strings e evite `eval`.
- Valide entradas, caminhos, URLs, inteiros, enums e pre-condicoes antes de
  produzir efeitos colaterais.
- Use `--` antes de operandos quando o comando externo oferecer suporte.
- Use `mktemp` e `trap` para recursos temporarios. Trate `INT` e `TERM` sem
  esconder o codigo de saida original.
- Nao exponha segredos em argumentos, logs, tracing ou mensagens de erro.
- Verifique dependencias com `command -v` e informe como resolver ausencias.
- Torne operacoes repetiveis idempotentes quando possivel. Para alteracoes
  relevantes, ofereca `--dry-run`.
- Nunca reduza confirmacoes, validacoes ou protecoes somente para facilitar um
  teste.

### Interface e interatividade

- Implemente `-h` e `--help` em CLIs nao triviais. Inclua uso, opcoes,
  subcomandos, exemplos e codigos de saida relevantes.
- Implemente `--version` para ferramentas distribuiveis ou versionadas.
- Reserve stdout para o resultado primario e stderr para progresso, avisos e
  erros. Use codigos diferentes de zero para falhas.
- Solicite entrada somente quando stdin for TTY. Nunca deixe CI ou pipelines
  esperando por um prompt.
- Toda entrada interativa deve possuir alternativa por flag, argumento,
  arquivo ou stdin. Ofereca `--no-input` para proibir prompts explicitamente.
- Para acoes destrutivas, use confirmacao proporcional ao risco e uma opcao
  explicita para automacao, como `--yes`, `--force` ou `--confirm VALOR`.
- Respeite `NO_COLOR`, `TERM=dumb`, redirecionamento de streams e
  `--no-color`. Nao use animacoes fora de TTY.
- Mensagens de erro devem dizer o que falhou, por que e qual acao segura o
  usuario pode tentar.

### Autocomplete

Avalie completion em todo script. Para uma CLI com flags, argumentos
enumerados ou subcomandos, entregue completion Bash junto com o script, salvo
se o usuario restringir explicitamente o escopo. Um script linear sem
parametros pode registrar que completion nao se aplica.

- Mantenha opcoes, subcomandos e aliases sincronizados entre parser, ajuda,
  completion e testes.
- Complete arquivos, diretorios e enums de forma contextual.
- Nao realize escrita, rede ou operacoes caras durante completion.
- Prefira um subcomando `completion bash` para ferramentas distribuidas ou um
  arquivo dedicado em `completions/` para projetos que ja usam esse padrao.
- Forneca a instrucao de ativacao, por exemplo:
  `source <(ferramenta completion bash)`.
- Gere zsh ou fish somente quando solicitado ou quando o projeto ja os
  suportar; nao finja compatibilidade sem testar.

Use `assets/bash-cli-template.sh` como ponto de partida para uma CLI nova e
`assets/bash-completion-template.bash` quando o projeto preferir completion em
arquivo separado. Adapte os modelos; nao copie funcionalidades desnecessarias.

## Validacao

Execute as verificacoes disponiveis nesta ordem:

1. `bash -n caminho/do/script.sh`
2. `shellcheck -x caminho/do/script.sh`
3. `shfmt -d -i 2 -ci caminho/do/script.sh`
4. testes Bats e testes de integracao relevantes
5. smoke tests de `--help`, `--version`, argumentos invalidos e completion
6. execucao nao interativa com stdin redirecionado para garantir que nao trava
7. `--dry-run` e confirmacoes de operacoes com efeitos colaterais

Neste projeto, use o ambiente reproduzivel:

```bash
docker compose -f docker-compose.cli.yaml build cli
docker compose -f docker-compose.cli.yaml run --rm cli \
  shellcheck -x caminho/do/script.sh
docker compose -f docker-compose.cli.yaml run --rm cli \
  shfmt -d -i 2 -ci caminho/do/script.sh
docker compose -f docker-compose.cli.yaml run --rm cli \
  bats caminho/dos/testes
```

Se uma ferramenta nao estiver disponivel, nao afirme que ela passou. Informe a
lacuna e ainda execute as verificacoes possiveis.

## Revisao de scripts existentes

Ao revisar, priorize bugs e riscos antes de estilo:

1. Injecao de comandos, expansoes sem aspas e remocao de caminhos inseguros.
2. Falhas mascaradas por pipelines, subshells ou captura incorreta de status.
3. Prompts que travam automacao e saida que quebra composicao.
4. Limpeza incorreta, sinais, temporarios e falta de idempotencia.
5. Divergencia entre parser, ajuda, exemplos, completion e testes.
6. Funcoes sem documentacao de contrato.

Corrija a causa raiz com o menor diff seguro. Nao reformate nem reescreva
trechos alheios ao problema.

## Entrega

Entregue os arquivos solicitados, incluindo completion e testes quando forem
aplicaveis. No resumo final, informe:

- interface criada ou preservada;
- decisoes de interatividade e automacao;
- completion fornecido e como ativa-lo;
- validacoes realmente executadas;
- dependencias, premissas ou riscos restantes.
