# common/nest-libs/iam-contracts

Contrato sem lógica entre `backend/apps/iam-service` e quem toma decisão de
acesso — hoje só `gateway-service`. Mesmo padrão de `quote-search-match`:
apenas constantes e tipos, nenhuma dependência de framework.

## Public API

- `PERMISSIONS` / `PermissionName` — nomes canônicos das permissões
  (`stores:read`, `finance:read`, ...). Importar daqui em vez de escrever a
  string literal: um typo vira erro de compilação em vez de mudança silenciosa
  de acesso.
- `ALL_PERMISSIONS` — usado pelo seed da role `administrator`.
- `ROLES` / `RoleName` — `administrator` e `operator`. Nomes de role são
  organizacionais; autorização é sempre expressa em permissão.
- `OPERATOR_PERMISSIONS` — conjunto somente-leitura dos seis domínios.
- `SessionIntrospection` — shape retornado pelo endpoint de introspecção.

## Consumers

- `backend/apps/iam-service` — semeia roles/permissões a partir destas constantes.
- `backend/apps/gateway-service` — declara a permissão exigida por rota (ainda
  não existe).
