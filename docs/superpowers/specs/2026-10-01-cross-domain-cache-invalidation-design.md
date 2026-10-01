# Invalidação de cache entre domínios após importação

## Contexto

O painel admin tem 14 `createApi` (RTK Query) separados por domínio
(`ingestion`, `treasury`, `finance`, `accounting`, `overview`, etc.) — cada
um isolado, sem `setupListeners()`, sem `refetchOnMountOrArgChange`, sem
`refetchOnFocus` em lugar nenhum do app (confirmado por busca no código
inteiro). Isso já era documentado em
[frontend/apps/admin/CLAUDE.md](../../frontend/apps/admin/CLAUDE.md) como
decisão deliberada (evitar tempestade de requisição), mas tem um efeito
colateral real: importar dado por um domínio (upload manual ou
sincronização com o Drive, tanto em `ingestion.ts` quanto em `treasury.ts`)
nunca avisa os outros domínios que o dado mudou.

Confirmado ao vivo em 2026-10-01: depois de sincronizar/importar extratos,
vendas e abastecimento de setembro — com o pipeline inteiro verificado
correto, dado por dado, até `finance-service` ter reconciliação real
(R$ 4.144,79 de perda, comparável a agosto) — as telas de DRE, Fluxo de
Caixa e Perdas continuaram mostrando o estado anterior à importação, numa
aba que já estava aberta. Só um recarregamento forçado da página trouxe o
dado novo.

Duas consultas relevantes **nem têm tag hoje**, então nem poderiam ser
invalidadas como estão: `getCashFlowSummary` (`treasury.ts`, o dashboard
real de Fluxo de Caixa) e `getOverview` (`overview.ts`). Isso precisa ser
corrigido como parte desta mudança, não só adicionar quem invalida — não
dá pra invalidar uma tag que a consulta nunca declarou.

## Objetivo

Depois de **qualquer** importação completar com sucesso — manual ou via
Drive, em qualquer uma das fontes (vendas, abastecimento, extrato
bancário, fatura de cartão) — toda tela que lê dado derivado dessa
importação deve atualizar sozinha, **mesmo que já esteja aberta**, sem
precisar de recarregar a página nem trocar de aba.

## Não-objetivos

- **Não ligar `refetchOnMountOrArgChange`/polling como mecanismo
  principal.** Resolve só "reabrir a aba depois", não "aba já aberta
  durante a importação" — que foi o caso real observado. Pode entrar como
  rede de segurança complementar, nunca como único mecanismo.
- **Não mexer nas 14 APIs inteiras.** Só os domínios cujo dado realmente
  deriva de uma importação (financeiro: DRE, Fluxo de Caixa,
  Reconciliação/Perdas, Visão geral) — `/products`, `/stores` e qualquer
  tela sem relação com dado importado ficam de fora.
- **Não muda o que cada importação já invalida dentro do próprio
  domínio** (ex.: `treasury.ts`'s `uploadStatements` já invalida
  `PendingImport` corretamente) — isso continua intacto; a mudança é
  **aditiva**, alcançando domínios que hoje não são avisados.

## Arquitetura

### Um helper central, não invalidação espalhada

Um arquivo novo, `frontend/apps/admin/src/lib/api/cross-domain-invalidate.ts`,
exporta uma função que recebe o `dispatch` do Redux e invalida, de uma vez,
toda tag de todo domínio financeiro afetado:

```ts
export function invalidateFinancialData(dispatch: AppDispatch) {
  dispatch(financeApi.util.invalidateTags(["Reconciliation"]));
  dispatch(accountingApi.util.invalidateTags(["Account", "Ledger"]));
  dispatch(treasuryApi.util.invalidateTags(["Transaction", "CashFlowSummary"]));
  dispatch(overviewApi.util.invalidateTags(["Overview"]));
}
```

(Os nomes exatos de tag serão confirmados contra o código real durante o
plano — `Account`/`Ledger` em `accounting.ts` já existem; `CashFlowSummary`
em `treasury.ts` e `Overview` em `overview.ts` são tags **novas**, que
precisam ser adicionadas à consulta correspondente antes de poderem ser
invalidadas.)

Cada mutation que **completa** uma importação — nas duas pontas,
`ingestion.ts` (upload manual de vendas/abastecimento, import de arquivo
do Drive) e `treasury.ts` (upload manual de extrato/fatura, import de
arquivo do Drive de tesouraria) — chama esse helper depois de confirmar
sucesso, via `onQueryStarted`/`.unwrap().then(...)` ou equivalente,
conforme o padrão RTK Query já usado no arquivo.

**Por que centralizado em vez de cada mutation invalidar direto**: se
amanhã um domínio novo passar a depender de dado importado (ex.: um
dashboard de CAPEX que lê CMV), o ajuste é num lugar só — a lista dentro
do helper — não em quatro arquivos de mutation diferentes que precisariam
lembrar de incluir o domínio novo.

### As duas consultas sem tag ganham uma

`getCashFlowSummary` (`treasury.ts`) e `getOverview` (`overview.ts`) não
têm `providesTags` hoje — não dá pra invalidar o que nunca foi marcado.
Cada uma ganha `providesTags: ["CashFlowSummary"]`/`["Overview"]`
(tag nova, `tagTypes` do respectivo `createApi` estendido), sem mudar
nenhum outro comportamento da consulta.

### Rede de segurança complementar

Além da invalidação central, `getReconciliationSeries` (`finance.ts`),
`getChart`/`getCashFlow` (`accounting.ts`), `getCashFlowSummary`/
`getTransactions` (`treasury.ts`) e `getOverview` ganham
`refetchOnMountOrArgChange: 30` (ou valor similar, a confirmar no plano)
— cobre o caso de alguém abrir essas telas **depois** que a importação já
terminou, sem depender só da invalidação central ter rodado certo.

## Tratamento de erro

- Uma importação que falha (qualquer status de erro) **nunca** chama o
  helper de invalidação — só sucesso confirmado dispara.
- Se uma das APIs invalidadas estiver com erro de rede no momento da
  invalidação, isso é só uma tentativa de refetch que falha como qualquer
  outra — não derruba a importação em si, que já terminou antes desse
  passo.

## Testes

- Teste do helper central: confirma que chamar `invalidateFinancialData`
  dispara exatamente as tags esperadas nas quatro APIs, nem mais nem
  menos.
- Teste de cada mutation que agora chama o helper: usa o mesmo padrão de
  mock já estabelecido (`jest.doMock` + `require` dinâmico) pra confirmar
  que o helper é chamado só no caminho de sucesso, nunca no de erro.
- Teste de aceitação manual: importar um arquivo real (upload manual ou
  via Drive) com uma tela financeira já aberta em outra aba/componente
  montado, confirmar que o dado atualiza sozinho sem reload.

## Gaps conhecidos

- A lista de tags dentro do helper central precisa ser mantida à mão
  conforme novos domínios financeiros aparecerem — não há mecanismo
  automático de descoberta. Documentado no próprio arquivo do helper.
- `refetchOnMountOrArgChange` com um valor de segundos específico é uma
  escolha arbitrária (nem muito curto, que reintroduz tempestade de
  requisição, nem muito longo, que não ajuda o caso real) — o valor exato
  é uma decisão de implementação, não uma restrição de design.
