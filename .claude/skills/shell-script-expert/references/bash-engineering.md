# Engenharia Bash

Use esta referencia ao criar ou revisar implementacoes Bash. A prioridade e
correcao observavel, seguida por seguranca, legibilidade e economia de
processos externos.

## Escolha do Bash

Bash funciona bem para orquestrar comandos, arquivos e processos. Reavalie a
linguagem quando o script acumular estruturas de dados aninhadas, parsing de
formatos complexos, concorrencia sofisticada ou muitas regras de negocio. O
numero de linhas e um sinal, nao uma regra absoluta.

Declare o alvo, por exemplo Bash 4.4 ou Bash 5.2. Nao use recursos de versoes
mais recentes sem explicitar a exigencia ou fornecer uma alternativa concreta.

## Strict mode e erros

`set -Eeuo pipefail` e um bom ponto de partida para scripts novos, mas cada
opcao tem semantica propria:

- `-e` possui excecoes em condicionais, listas e substitutions. Nao o trate
  como substituto de verificacao explicita.
- `-u` exige defaults intencionais para argumentos e variaveis opcionais.
- `pipefail` evita que uma falha anterior do pipeline seja mascarada.
- `-E` propaga o trap `ERR`, mas o trap precisa preservar contexto e status.

Prefira testar comandos diretamente:

```bash
if ! resultado="$(comando)"; then
  printf 'Nao foi possivel obter o resultado.\n' >&2
  return 1
fi
```

Nao use `$?` depois de outro comando. Separe declaracao e command substitution
para nao mascarar o status de saida:

```bash
local resultado
resultado="$(comando)"
```

## Expansoes e colecoes

- Use `"${valor}"`, `"${array[@]}"` e `"$@"`.
- Use arrays para listas e argumentos de comandos.
- Use `mapfile -t` ou `while IFS= read -r` para linhas.
- Nao itere sobre `$(ls ...)` ou expansoes que dividem por espacos.
- Use `[[ ... ]]` para testes Bash e `(( ... ))` para aritmetica.
- Use `$(...)` em vez de crases.
- Use `printf` com formato constante em vez de `echo` para dados variaveis.

Exemplo seguro para construir um comando:

```bash
local -a command_args=(--archive --verbose)
command_args+=(--file "${archive_path}")
tar "${command_args[@]}" -- "${source_path}"
```

## Funcoes e estado

- Declare variaveis de funcao com `local`.
- Evite modificar globais implicitamente. Documente cada global lida ou
  alterada.
- Retorne somente status entre 0 e 255. Escreva valores em stdout ou atribua
  por referencia apenas quando a convencao estiver clara.
- Reserve stdout de funcoes consultivas para o valor retornado; envie logs para
  stderr.
- Nao esconda codigo executavel entre definicoes de funcao.
- Use uma funcao `main` em scripts nao triviais.

## Caminhos, temporarios e remocao

- Valide variaveis antes de `rm`, especialmente quando formarem globs.
- Use `rm -- "${path}"` quando suportado e rejeite caminho vazio, `/` ou outro
  alvo proibido.
- Crie temporarios com `mktemp` e limite permissoes quando contiverem dados
  sensiveis.
- Registre limpeza com `trap`, preservando o status original.
- Resolva caminhos somente quando isso fizer parte do contrato; links
  simbolicos podem alterar a seguranca da operacao.
- Nao use nomes temporarios previsiveis em `/tmp`.

## Sinais e processos

- Trate `INT` e `TERM` quando o script gerenciar recursos ou filhos.
- Encaminhe sinais a processos filhos quando o script atuar como supervisor.
- Nao tente capturar `KILL` ou `STOP`.
- Evite jobs em background sem coleta por `wait`.
- Registre PIDs de forma estruturada e nao confunda PID reutilizado com
  identidade permanente.

## Dependencias e portabilidade

- Detecte comandos com `command -v`.
- Prefira builtins quando forem mais claros e suficientes.
- Nao presuma variantes GNU em macOS ou BusyBox. Verifique o ambiente alvo.
- Use shebang e recursos coerentes: um script Bash nao deve declarar `/bin/sh`.
- Defina locale quando ordenacao, regex ou parsing dependerem dele.
- Nao altere globalmente `IFS` sem restauracao e justificativa.

## Seguranca

- Evite `eval`, `bash -c` com entrada interpolada e strings que representem
  comandos.
- Nao execute `curl ... | bash`.
- Valide URLs e destinos antes de download ou escrita.
- Nao aceite senha ou token por flag quando isso os expuser no historico ou em
  `ps`. Prefira arquivo protegido, stdin ou gerenciador de segredos.
- Crie arquivos sensiveis com umask restritiva.
- Evite logs de ambiente completo ou comandos com argumentos secretos.
- Nao eleve privilegios internamente sem uma necessidade explicita. Explique
  quando o usuario deve executar uma etapa privilegiada.

## Testabilidade

- Separe parsing, validacao e efeitos colaterais.
- Permita substituir comandos externos por PATH controlado nos testes quando
  isso nao enfraquecer a producao.
- Use diretorios temporarios por teste.
- Teste nomes de arquivo com espacos, glob characters, hifens e linhas vazias.
- Teste sucesso, falha de dependencia, entrada invalida, interrupcao e nova
  execucao.
- Teste codigos de saida e streams, nao apenas texto combinado.

## Fontes tecnicas

- GNU Bash Reference Manual: https://www.gnu.org/software/bash/manual/bash.html
- Google Shell Style Guide: https://google.github.io/styleguide/shellguide.html
- ShellCheck Wiki: https://www.shellcheck.net/wiki/
