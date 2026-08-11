#!/usr/bin/env bash
# Fixture intencionalmente insegura para a avaliacao de revisao da skill.
# Nao use este arquivo como exemplo de implementacao nem o execute em producao.

TEMP_DIR="/tmp/legacy-report.$$"

render_report() {
  eval "printf 'Relatorio: %s\\n' $1"
}

cleanup() {
  rm -rf $TEMP_DIR
}

confirm() {
  read -p "Continuar? [s/N] " answer
  [ "$answer" = s ]
}

mkdir -p $TEMP_DIR
render_report $1
confirm && cleanup
