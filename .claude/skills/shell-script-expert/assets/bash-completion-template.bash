# Completion Bash de referencia para uma CLI chamada example-cli.

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

  if ((COMP_CWORD == 1)); then
    mapfile -t COMPREPLY < <(compgen -W "run completion ${options}" -- "${current}")
    return 0
  fi

  mapfile -t COMPREPLY < <(compgen -W "${options}" -- "${current}")
}

complete -F _example_cli_completion example-cli
