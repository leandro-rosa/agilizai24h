#!/usr/bin/env bats

SCRIPT="${BATS_TEST_DIRNAME}/../assets/bash-cli-template.sh"
COMPLETION="${BATS_TEST_DIRNAME}/../assets/bash-completion-template.bash"

@test "exibe ajuda e versao com sucesso" {
  run bash "${SCRIPT}" --help
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'Uso:'* ]]

  run bash "${SCRIPT}" --version
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'0.1.0'* ]]
}

@test "dry-run preserva alvo com espacos" {
  run bash "${SCRIPT}" --dry-run run 'alvo com espacos'
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'alvo com espacos'* ]]
}

@test "modo nao interativo falha sem confirmacao" {
  run bash "${SCRIPT}" --no-input run alvo
  [ "${status}" -eq 3 ]
  [[ "${output}" == *'Use --yes'* ]]
}

@test "modo nao interativo aceita confirmacao explicita" {
  run bash "${SCRIPT}" --no-input --yes run alvo
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'Operacao concluida'* ]]
}

@test "opcao desconhecida retorna erro de uso" {
  run bash "${SCRIPT}" --inexistente
  [ "${status}" -eq 2 ]
  [[ "${output}" == *'Use --help'* ]]
}

@test "completion dedicada registra o comando" {
  run bash -c 'source "$1" && complete -p example-cli' _ "${COMPLETION}"
  [ "${status}" -eq 0 ]
  [[ "${output}" == *'_example_cli_completion example-cli'* ]]
}

@test "completion emitida possui sintaxe Bash valida" {
  run bash -c 'bash "$1" completion bash | bash -n' _ "${SCRIPT}"
  [ "${status}" -eq 0 ]
}
