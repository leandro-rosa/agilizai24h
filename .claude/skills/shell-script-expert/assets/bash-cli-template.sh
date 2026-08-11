#!/usr/bin/env bash
# CLI Bash de referencia com ajuda, dry-run, modo nao interativo e completion.

set -Eeuo pipefail

readonly PROGRAM_NAME="${0##*/}"
readonly PROGRAM_VERSION='0.1.0'

DRY_RUN=false
NON_INTERACTIVE=false
ASSUME_YES=false
VERBOSE=false
ACTION=''
TARGET=''

#######################################
# Exibe a ajuda completa da CLI.
# Globals:
#   PROGRAM_NAME
# Arguments:
#   Nenhum
# Outputs:
#   Escreve a ajuda em stdout.
# Returns:
#   0 sempre.
# Side effects:
#   Nenhum
#######################################
print_help() {
  cat <<EOF
Uso:
  ${PROGRAM_NAME} [opcoes] run ALVO
  ${PROGRAM_NAME} completion bash

Executa uma operacao de exemplo de forma interativa ou automatizavel.

Opcoes:
  -n, --dry-run     Mostra a operacao sem executa-la
      --no-input    Proibe qualquer prompt
  -y, --yes         Confirma a operacao sem prompt
  -v, --verbose     Exibe detalhes em stderr
  -h, --help        Exibe esta ajuda
      --version     Exibe a versao

Exemplos:
  ${PROGRAM_NAME} --dry-run run ./destino
  ${PROGRAM_NAME} --no-input --yes run ./destino
  source <(${PROGRAM_NAME} completion bash)

Codigos de saida:
  0  Sucesso
  2  Uso ou entrada invalida
  3  Interacao necessaria, mas indisponivel
EOF
}

#######################################
# Exibe a versao da CLI.
# Globals:
#   PROGRAM_NAME
#   PROGRAM_VERSION
# Arguments:
#   Nenhum
# Outputs:
#   Escreve nome e versao em stdout.
# Returns:
#   0 sempre.
# Side effects:
#   Nenhum
#######################################
print_version() {
  printf '%s %s\n' "${PROGRAM_NAME}" "${PROGRAM_VERSION}"
}

#######################################
# Escreve uma mensagem de diagnostico quando verbose esta ativo.
# Globals:
#   VERBOSE
# Arguments:
#   $@ - Partes da mensagem.
# Outputs:
#   Escreve a mensagem em stderr quando habilitada.
# Returns:
#   0 sempre.
# Side effects:
#   Nenhum
#######################################
log_verbose() {
  if [[ "${VERBOSE}" == true ]]; then
    printf '%s\n' "$*" >&2
  fi
}

#######################################
# Encerra a execucao com uma mensagem acionavel.
# Globals:
#   Nenhuma
# Arguments:
#   $1 - Mensagem de erro.
#   $2 - Codigo de saida opcional; padrao 1.
# Outputs:
#   Escreve a mensagem em stderr.
# Returns:
#   Nao retorna; encerra o processo com o codigo solicitado.
# Side effects:
#   Encerra o processo atual.
#######################################
die() {
  local message="$1"
  local exit_code="${2:-1}"

  printf 'Erro: %s\n' "${message}" >&2
  exit "${exit_code}"
}

#######################################
# Solicita confirmacao sem bloquear ambientes nao interativos.
# Globals:
#   ASSUME_YES
#   NON_INTERACTIVE
# Arguments:
#   $1 - Descricao da acao a confirmar.
# Outputs:
#   Escreve o prompt ou o motivo da falha em stderr.
# Returns:
#   0 quando confirmado; 3 quando a confirmacao nao foi obtida.
# Side effects:
#   Le uma linha de stdin quando ele e um TTY.
#######################################
confirm_action() {
  local description="$1"
  local reply=''

  if [[ "${ASSUME_YES}" == true ]]; then
    return 0
  fi

  if [[ "${NON_INTERACTIVE}" == true || ! -t 0 ]]; then
    printf 'Confirmacao necessaria. Use --yes para autorizar: %s\n' \
      "${description}" >&2
    return 3
  fi

  printf '%s [s/N] ' "${description}" >&2
  IFS= read -r reply
  [[ "${reply}" == 's' || "${reply}" == 'S' ]]
}

#######################################
# Executa ou simula a operacao principal.
# Globals:
#   DRY_RUN
# Arguments:
#   $1 - Alvo validado da operacao.
# Outputs:
#   Escreve o resultado primario em stdout e diagnosticos em stderr.
# Returns:
#   0 em sucesso; 3 quando a confirmacao nao e obtida.
# Side effects:
#   Representa o ponto em que a operacao real seria executada.
#######################################
run_action() {
  local target="$1"

  log_verbose "Alvo validado: ${target}"
  if [[ "${DRY_RUN}" == true ]]; then
    printf '[dry-run] Operaria sobre: %s\n' "${target}"
    return 0
  fi

  if ! confirm_action "Executar a operacao sobre '${target}'?"; then
    return 3
  fi

  printf 'Operacao concluida sobre: %s\n' "${target}"
}

#######################################
# Emite o script de programmable completion para Bash.
# Globals:
#   Nenhuma
# Arguments:
#   Nenhum
# Outputs:
#   Escreve o script de completion em stdout.
# Returns:
#   0 sempre.
# Side effects:
#   Nenhum
#######################################
print_bash_completion() {
  cat <<'EOF'
# Completion Bash para example-cli.
#######################################
# Completa opcoes, subcomandos e caminhos aceitos pela CLI.
# Globals:
#   COMP_WORDS
#   COMP_CWORD
#   COMPREPLY
# Arguments:
#   Nenhum
# Outputs:
#   Preenche COMPREPLY.
# Returns:
#   0 sempre.
# Side effects:
#   Altera COMPREPLY no shell interativo atual.
#######################################
_example_cli_completion() {
  local current="${COMP_WORDS[COMP_CWORD]}"
  local previous="${COMP_WORDS[COMP_CWORD - 1]:-}"
  local options='--dry-run --no-input --yes --verbose --help --version'

  if [[ "${previous}" == 'run' ]]; then
    mapfile -t COMPREPLY < <(compgen -f -- "${current}")
    return 0
  fi

  if (( COMP_CWORD == 1 )); then
    mapfile -t COMPREPLY < <(compgen -W "run completion ${options}" -- "${current}")
    return 0
  fi

  mapfile -t COMPREPLY < <(compgen -W "${options}" -- "${current}")
}

complete -F _example_cli_completion example-cli
EOF
}

#######################################
# Converte argumentos da linha de comando no estado da aplicacao.
# Globals:
#   ACTION
#   ASSUME_YES
#   DRY_RUN
#   NON_INTERACTIVE
#   TARGET
#   VERBOSE
# Arguments:
#   $@ - Argumentos originais da CLI.
# Outputs:
#   Pode exibir ajuda, versao ou completion em stdout; erros em stderr.
# Returns:
#   0 quando os argumentos sao validos.
# Side effects:
#   Atualiza o estado global do parser ou encerra para opcoes terminais.
#######################################
parse_args() {
  while (($# > 0)); do
    case "$1" in
      -n | --dry-run) DRY_RUN=true ;;
      --no-input) NON_INTERACTIVE=true ;;
      -y | --yes) ASSUME_YES=true ;;
      -v | --verbose) VERBOSE=true ;;
      -h | --help)
        print_help
        exit 0
        ;;
      --version)
        print_version
        exit 0
        ;;
      completion)
        [[ "${2:-}" == 'bash' ]] || die "Use 'completion bash'." 2
        print_bash_completion
        exit 0
        ;;
      run)
        [[ -z "${ACTION}" ]] || die 'Informe apenas um subcomando.' 2
        ACTION='run'
        shift
        (($# > 0)) || die "O subcomando 'run' exige ALVO." 2
        TARGET="$1"
        ;;
      --)
        shift
        break
        ;;
      -*) die "Opcao desconhecida: $1. Use --help." 2 ;;
      *) die "Argumento inesperado: $1. Use --help." 2 ;;
    esac
    shift
  done

  [[ "${ACTION}" == 'run' ]] || die "Informe um subcomando. Use --help." 2
  [[ -n "${TARGET}" ]] || die 'O alvo nao pode ser vazio.' 2
}

#######################################
# Coordena parsing e execucao da CLI.
# Globals:
#   ACTION
#   TARGET
# Arguments:
#   $@ - Argumentos originais da CLI.
# Outputs:
#   Delega resultados para as funcoes chamadas.
# Returns:
#   0 em sucesso; propaga codigos de falha das operacoes.
# Side effects:
#   Executa a acao escolhida pelo usuario.
#######################################
main() {
  parse_args "$@"

  case "${ACTION}" in
    run) run_action "${TARGET}" ;;
    *) die "Acao interna invalida: ${ACTION}" 2 ;;
  esac
}

main "$@"
