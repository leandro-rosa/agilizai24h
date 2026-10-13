# Fechamento de consignação — Fase 2a: acerto histórico, último acerto, acordo e custos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar o acerto 22/09–29/09/2026 (R$ 697,11, pago em 30/09) como acerto histórico já pago, mostrar na tela o "último acerto" de cada fornecedor, impedir que qualquer acerto novo cubra dias já acertados, e guardar o acordo de consignação (periodicidade, data inicial) e os custos de repasse com vigência.

**Architecture:** Aditivo no `suppliers-service` (módulo `purchasing`): a tabela `settlement` ganha `kind` e o intervalo de dias coberto; duas tabelas novas (`consignment_agreement`, `consignment_cost`); regras puras em `utils/` (cobertura de dias, validação do acerto histórico, validação de acordo/custo) com TDD; serviço e rotas novos; o gateway só repassa; o admin mostra o último acerto e abre o acerto histórico. Nada do razão de estoque entra aqui (Fase 2b).

**Tech Stack:** NestJS + Prisma 7 (`prisma-client`, migration SQL escrita à mão), class-validator, jest 30; Next.js + RTK Query + Testing Library no admin.

**Spec:** `docs/superpowers/specs/2026-10-13-supplier-consignment-closing-design.md` (§3, §7, §8 e a conciliação 2a do §11). Fase anterior: `docs/superpowers/plans/2026-10-13-consignment-closing-phase-1-domain-rules.md` (já na `main`).

## Roteiro das fases

1. Regras puras — **feita** (`main`).
2. **2a (este plano)**: acerto histórico, último acerto, acordo e custos.
3. 2b: razão de movimentos, saldo inicial, recebimento parcial, transferência, baixa por vencimento e devolução (plano separado, depois da 2a).
4. Fase 3: vendas por loja com chave e normalização de horário; motivo por visita na ingestão.
5. Fase 4: serviço do fechamento (estados, pagamentos, confirmação, cancelamento, PDF/Excel).
6. Fase 5: telas do admin.

## Global Constraints

- Dinheiro em **centavos inteiros**, nunca float.
- Datas de acerto são **dias de São Paulo** em colunas `DATE`, intervalo `[início, fim)` com fim exclusivo; o dia final mostrado ao usuário é inclusivo (fim − 1 dia).
- O acerto histórico é **`kind = 'legacy'`, estado `paid`**, e **nunca** entra no cálculo de acertos regulares (`priorLines` só lê `kind = 'regular'`).
- Nenhum acerto confirmado/pago pode cobrir dias já cobertos por outro confirmado/pago do mesmo fornecedor (`409`); um acerto novo (proposta ou histórico) que se sobreponha é recusado.
- Custo de repasse = **vigência na data da venda**; `cost_basis` do acordo é sempre `sale_date` nesta entrega (não existe "custo do lote").
- Vigência de custo é **append-only**: nunca se edita nem se apaga; corrigir é lançar outra vigência.
- Dado sintético **nunca** vai a banco real: testes de integração só em banco descartável (`CONSIGNMENT_IT_THROWAWAY_DB=true`); o registro do acerto real (Task 8) só com aprovação explícita do dono.
- Estilo do repo: TypeScript sem ponto e vírgula no backend (aspas simples), com ponto e vírgula e aspas duplas no admin; comentários só onde explicam regra de negócio; texto de UI em português, código em inglês.

## Review Focus

1. Evidência do acerto histórico não pode contaminar o cálculo de acertos regulares (`priorLines` lê `evidence.lines`): conferir `kind` e `lines: []` (Task 4).
2. Registrar o mesmo acerto duas vezes, ou um que se sobreponha ao anterior, deve dar `409`, nunca duplicar a dívida (Tasks 4 e 8).
3. Total digitado diferente da soma das linhas, linha com quantidade × custo ≠ total, ou `paid_on` anterior ao fim do período: recusar com o motivo, tudo de uma vez (Task 3).
4. Fornecedor sem acerto confirmado: "último acerto" é `null` e a tela diz isso, nunca uma data inventada (Tasks 4 e 7).
5. Proposta de semana que toca os dias do acerto histórico (ex.: semana de 21 a 27/09 × 22 a 29/09): recusar (Task 4).

---

### Task 1: Esquema e migração

**Files:**
- Modify: `backend/apps/suppliers-service/prisma/schema.prisma` (model `Settlement`; novos `ConsignmentAgreement`, `ConsignmentCost`; relações em `Supplier`)
- Create: `backend/apps/suppliers-service/prisma/migrations/20261013120000_consignment_agreement_and_legacy_settlement/migration.sql`
- Modify: `backend/apps/suppliers-service/src/modules/purchasing/services/settlement.service.ts` (o `upsert` de `propose` passa a gravar o intervalo)
- Test: `backend/apps/suppliers-service/test/consignment.integration-spec.ts`

**Interfaces:**
- Produces: colunas `settlement.kind` (`'regular' | 'legacy'`, padrão `'regular'`), `settlement.period_start` e `settlement.period_end` (`DATE`, fim exclusivo, `NOT NULL`); tabelas `consignment_agreement` (`supplier_id` único) e `consignment_cost` (único por `supplier_id, sku, valid_from`).

- [ ] **Step 1: Write the failing integration test**

```ts
import 'reflect-metadata'
import { ConfigModule } from '@nestjs/config'
import { Test, type TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module'
import { PrismaClientService } from '../src/modules/db-client/prisma-client.service'

/**
 * Constraints of the consignment tables, with SYNTHETIC data. Runs ONLY against a throwaway database
 * (CONSIGNMENT_IT_THROWAWAY_DB=true and DATABASE_URL pointing at it): never against the real one.
 */
const throwaway = process.env.CONSIGNMENT_IT_THROWAWAY_DB === 'true'

;(throwaway ? describe : describe.skip)('consignment tables (throwaway database, synthetic data)', () => {
  let app: TestingModule
  let prisma: PrismaClientService
  let supplierId: number

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AppModule] }).compile()
    prisma = app.get(PrismaClientService)
    const supplier = await prisma.supplier.create({ data: { name: '[SINTÉTICO] consignado', category: 'frozen' } })
    supplierId = supplier.id
  })

  afterAll(async () => {
    await prisma.consignmentCost.deleteMany({ where: { supplier_id: supplierId } })
    await prisma.consignmentAgreement.deleteMany({ where: { supplier_id: supplierId } })
    await prisma.settlement.deleteMany({ where: { supplier_id: supplierId } })
    await prisma.supplier.delete({ where: { id: supplierId } })
    await app.close()
  })

  const settlement = (over: Record<string, unknown> = {}) => ({
    supplier_id: supplierId, week_start: new Date('2026-09-22T00:00:00Z'), period_start: new Date('2026-09-22T00:00:00Z'), period_end: new Date('2026-09-30T00:00:00Z'),
    kind: 'legacy', state: 'paid', owed_cents: 100, evidence: {}, ...over,
  })

  it('refuses a settlement whose period ends before it starts', async () => {
    await expect(prisma.settlement.create({ data: settlement({ week_start: new Date('2026-08-01T00:00:00Z'), period_start: new Date('2026-08-10T00:00:00Z'), period_end: new Date('2026-08-10T00:00:00Z') }) as never })).rejects.toThrow()
  })

  it('refuses an unknown settlement kind', async () => {
    await expect(prisma.settlement.create({ data: settlement({ week_start: new Date('2026-07-01T00:00:00Z'), period_start: new Date('2026-07-01T00:00:00Z'), period_end: new Date('2026-07-08T00:00:00Z'), kind: 'other' }) as never })).rejects.toThrow()
  })

  it('keeps one agreement per supplier', async () => {
    await prisma.consignmentAgreement.create({ data: { supplier_id: supplierId, period_days: 7 } })
    await expect(prisma.consignmentAgreement.create({ data: { supplier_id: supplierId, period_days: 10 } })).rejects.toThrow()
  })

  it('keeps one cost per supplier, SKU and vigência — a correction is another vigência', async () => {
    await prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-1', valid_from: new Date('2026-09-01T00:00:00Z'), unit_cost_cents: 730 } })
    await expect(prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-1', valid_from: new Date('2026-09-01T00:00:00Z'), unit_cost_cents: 999 } })).rejects.toThrow()
    await expect(prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-1', valid_from: new Date('2026-10-05T00:00:00Z'), unit_cost_cents: 760 } })).resolves.toBeDefined()
  })

  it('refuses a negative cost', async () => {
    await expect(prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: 'SINT-2', valid_from: new Date('2026-09-01T00:00:00Z'), unit_cost_cents: -1 } })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Start a throwaway database and run the test to see it fail**

Run (da raiz do repo):

```bash
docker run --rm -d --name consignment-it -e POSTGRES_PASSWORD=it -p 55432:5432 postgres:16-alpine
```

Depois, em `backend/apps/suppliers-service`:

```bash
export DATABASE_URL=postgresql://postgres:it@localhost:55432/postgres
pnpm exec prisma migrate deploy
CONSIGNMENT_IT_THROWAWAY_DB=true pnpm test:integration -- consignment
```

Expected: FAIL (`prisma.consignmentCost` não existe / tabelas ausentes). Se o `migrate deploy` ainda não conhece a migração nova, ele aplica só as antigas: é o esperado neste passo.

- [ ] **Step 3: Update the Prisma schema**

Em `prisma/schema.prisma`, substituir o model `Settlement` por:

```prisma
model Settlement {
  id          Int      @id @default(autoincrement())
  supplier_id Int
  /// Primeiro dia coberto (segunda-feira da semana ISO nos acertos regulares).
  week_start  DateTime @db.Date
  /// regular | legacy. Um acerto `legacy` veio de fora do sistema (planilha) e já está pago; nunca entra no saldo corrido dos regulares.
  kind        String   @default("regular")
  /// Dias de São Paulo cobertos: [period_start, period_end), fim exclusivo.
  period_start DateTime @db.Date
  period_end   DateTime @db.Date
  /// proposal | confirmed | paid
  state       String   @default("proposal")
  owed_cents  Int
  /// A semana não tem todos os dados (recibos sem data, lojas sem importação).
  partial     Boolean  @default(false)
  /// Linhas por item (entregue, vendido, vencido, devolvido, em aberto, devido) e as notas de qualidade.
  evidence    Json
  confirmed_at DateTime?
  paid_on      DateTime? @db.Date
  payment_note String?
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt

  supplier Supplier @relation(fields: [supplier_id], references: [id])

  @@unique([supplier_id, week_start])
  @@index([state])
  @@index([supplier_id, period_end])
  @@map("settlement")
}

/// O acordo de consignação de um fornecedor: de quanto em quanto tempo se fecha e quando começou. O custo de repasse é sempre o vigente na
/// data da venda (`ConsignmentCost`); não existe modo "custo do lote recebido" nesta entrega.
model ConsignmentAgreement {
  id          Int      @id @default(autoincrement())
  supplier_id Int      @unique
  /// 7, 10, 15 ou um número de dias personalizado.
  period_days Int
  /// Início do primeiro fechamento regular. Nulo até o saldo inicial ser confirmado.
  first_closing_on DateTime? @db.Date
  /// Único valor aceito hoje.
  cost_basis  String   @default("sale_date")
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt

  supplier Supplier @relation(fields: [supplier_id], references: [id])

  @@map("consignment_agreement")
}

/// Custo de repasse de um SKU a partir de `valid_from`. Append-only: corrigir é lançar outra vigência, nunca editar a antiga.
model ConsignmentCost {
  id              Int      @id @default(autoincrement())
  supplier_id     Int
  sku             String
  valid_from      DateTime @db.Date
  unit_cost_cents Int
  note            String?
  created_at      DateTime @default(now())

  supplier Supplier @relation(fields: [supplier_id], references: [id])

  @@unique([supplier_id, sku, valid_from])
  @@index([supplier_id, sku])
  @@map("consignment_cost")
}
```

No model `Supplier`, acrescentar as relações (junto das outras listas de relação do model):

```prisma
  consignment_agreement ConsignmentAgreement?
  consignment_costs     ConsignmentCost[]
```

- [ ] **Step 4: Write the migration**

`prisma/migrations/20261013120000_consignment_agreement_and_legacy_settlement/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "settlement" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'regular',
ADD COLUMN "period_start" DATE,
ADD COLUMN "period_end" DATE;

-- Acertos regulares existentes cobrem a semana: [segunda, segunda seguinte)
UPDATE "settlement" SET "period_start" = "week_start", "period_end" = "week_start" + 7 WHERE "period_start" IS NULL;

ALTER TABLE "settlement" ALTER COLUMN "period_start" SET NOT NULL, ALTER COLUMN "period_end" SET NOT NULL;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_period_order" CHECK ("period_end" > "period_start");
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_kind_known" CHECK ("kind" IN ('regular', 'legacy'));

-- CreateIndex
CREATE INDEX "settlement_supplier_id_period_end_idx" ON "settlement"("supplier_id", "period_end");

-- CreateTable
CREATE TABLE "consignment_agreement" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "period_days" INTEGER NOT NULL,
    "first_closing_on" DATE,
    "cost_basis" TEXT NOT NULL DEFAULT 'sale_date',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consignment_agreement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consignment_agreement_period_days_positive" CHECK ("period_days" >= 1),
    CONSTRAINT "consignment_agreement_cost_basis_known" CHECK ("cost_basis" = 'sale_date')
);

-- CreateTable
CREATE TABLE "consignment_cost" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "unit_cost_cents" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignment_cost_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consignment_cost_not_negative" CHECK ("unit_cost_cents" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "consignment_agreement_supplier_id_key" ON "consignment_agreement"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "consignment_cost_supplier_id_sku_valid_from_key" ON "consignment_cost"("supplier_id", "sku", "valid_from");

-- CreateIndex
CREATE INDEX "consignment_cost_supplier_id_sku_idx" ON "consignment_cost"("supplier_id", "sku");

-- AddForeignKey
ALTER TABLE "consignment_agreement" ADD CONSTRAINT "consignment_agreement_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_cost" ADD CONSTRAINT "consignment_cost_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Make `propose` write the period (so typecheck stays green)**

Em `settlement.service.ts`, no `upsert` de `propose`, trocar `create`/`update` por:

```ts
    const periodEnd = new Date(`${addDays(weekStart, 7)}T00:00:00Z`)
    const saved = await this.prisma.settlement.upsert({
      where: { supplier_id_week_start: { supplier_id: dto.supplier_id, week_start: weekDate } },
      create: { supplier_id: dto.supplier_id, week_start: weekDate, period_start: weekDate, period_end: periodEnd, state: 'proposal', owed_cents: result.owedCents, partial, evidence: evidence as never },
      update: { owed_cents: result.owedCents, partial, evidence: evidence as never },
      include: { supplier: true },
    })
```

e trocar o import `import { isDay, weekRange, weekStartOf } from '../utils/week'` por `import { addDays, isDay, weekRange, weekStartOf } from '../utils/week'`.

- [ ] **Step 6: Generate, migrate and run the test to see it pass**

Em `backend/apps/suppliers-service` (com `DATABASE_URL` do banco descartável):

```bash
pnpm exec prisma generate
pnpm exec prisma migrate deploy
CONSIGNMENT_IT_THROWAWAY_DB=true pnpm test:integration -- consignment
pnpm typecheck && pnpm test
```

Expected: 5 testes de integração passam; `typecheck` limpo; suíte unitária verde (a mesma contagem de antes).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/suppliers-service/prisma backend/apps/suppliers-service/test/consignment.integration-spec.ts backend/apps/suppliers-service/src/modules/purchasing/services/settlement.service.ts
git commit -m "feat(suppliers): settlement kind and covered period, consignment agreement and cost tables"
```

---

### Task 2: Cobertura de dias (regra pura)

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/settlement-coverage.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/settlement-coverage.spec.ts`

**Interfaces:**
- Consumes: `addDays(day: string, delta: number): string` de `./week`.
- Produces: `interface DayInterval { from: string; until: string }` (`from` incluso, `until` exclusivo, `YYYY-MM-DD`); `weekInterval(weekStart: string): DayInterval`; `daysOverlap(a: DayInterval, b: DayInterval): boolean`; `findOverlap(candidate: DayInterval, existing: Array<DayInterval & { id: number }>): number | null`; `lastDay(interval: DayInterval): string`.

- [ ] **Step 1: Write the failing test**

```ts
import { daysOverlap, findOverlap, lastDay, weekInterval } from './settlement-coverage'

describe('settlement coverage — which days a settlement already covers', () => {
  it('a week covers Monday through Sunday, the next Monday being the exclusive end', () => {
    expect(weekInterval('2026-10-05')).toEqual({ from: '2026-10-05', until: '2026-10-12' })
    expect(lastDay(weekInterval('2026-10-05'))).toBe('2026-10-11')
  })

  it('adjacent intervals do not overlap; one shared day does', () => {
    const legacy = { from: '2026-09-22', until: '2026-09-30' }

    expect(daysOverlap(legacy, { from: '2026-09-30', until: '2026-10-07' })).toBe(false)
    expect(daysOverlap(legacy, { from: '2026-09-29', until: '2026-10-06' })).toBe(true)
  })

  it('the week of 21/09 overlaps a settlement of 22/09 to 29/09 (the real case)', () => {
    expect(daysOverlap(weekInterval('2026-09-21'), { from: '2026-09-22', until: '2026-09-30' })).toBe(true)
  })

  it('returns the id of the first covered interval it touches, or null', () => {
    const existing = [{ id: 1, from: '2026-09-01', until: '2026-09-08' }, { id: 2, from: '2026-09-22', until: '2026-09-30' }]

    expect(findOverlap({ from: '2026-09-28', until: '2026-10-05' }, existing)).toBe(2)
    expect(findOverlap({ from: '2026-09-30', until: '2026-10-07' }, existing)).toBeNull()
    expect(findOverlap({ from: '2026-10-01', until: '2026-10-08' }, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (em `backend/apps/suppliers-service`): `pnpm test -- settlement-coverage`
Expected: FAIL, `Cannot find module './settlement-coverage'`

- [ ] **Step 3: Write minimal implementation**

```ts
import { addDays } from './week'

/** Sao Paulo calendar days: `from` is included, `until` is the exclusive end (`YYYY-MM-DD`). */
export interface DayInterval {
  from: string
  until: string
}

/** Monday through Sunday of the week starting at `weekStart`. */
export function weekInterval(weekStart: string): DayInterval {
  return { from: weekStart, until: addDays(weekStart, 7) }
}

export function daysOverlap(a: DayInterval, b: DayInterval): boolean {
  return a.from < b.until && b.from < a.until
}

/** The id of the first already-covered interval that shares a day with `candidate`, or null. */
export function findOverlap(candidate: DayInterval, existing: Array<DayInterval & { id: number }>): number | null {
  return existing.find(interval => daysOverlap(candidate, interval))?.id ?? null
}

/** The last covered day, included (what the screen shows). */
export function lastDay(interval: DayInterval): string {
  return addDays(interval.until, -1)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- settlement-coverage`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/settlement-coverage.ts backend/apps/suppliers-service/src/modules/purchasing/utils/settlement-coverage.spec.ts
git commit -m "feat(suppliers): day coverage of settlements, to refuse overlapping periods"
```

---

### Task 3: Validação e evidência do acerto histórico (regra pura)

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/legacy-settlement.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/legacy-settlement.spec.ts`

**Interfaces:**
- Consumes: `isDay`, `addDays` de `./week`; `DayInterval` de `./settlement-coverage`.
- Produces: `interface LegacyLineInput { name: string; sku?: string | null; unit_cost_cents: number; quantity: number; total_cents: number }`; `interface LegacyInput { period_from: string; period_to: string; paid_on: string; total_cents: number; lines: LegacyLineInput[]; source?: string; actor?: string }`; `validateLegacy(input: LegacyInput): string[]` (lista de problemas, vazia = válido); `legacyInterval(input: LegacyInput): DayInterval`; `legacyEvidence(input: LegacyInput): LegacyEvidence`.

- [ ] **Step 1: Write the failing test**

```ts
import { legacyEvidence, legacyInterval, validateLegacy, type LegacyInput } from './legacy-settlement'

const valid = (over: Partial<LegacyInput> = {}): LegacyInput => ({
  period_from: '2026-09-22',
  period_to: '2026-09-29',
  paid_on: '2026-09-30',
  total_cents: 22155,
  lines: [
    { name: 'Pão de mel', sku: '110022', unit_cost_cents: 730, quantity: 30, total_cents: 21900 },
    { name: 'Pizza de marguerita', sku: '9992', unit_cost_cents: 792, quantity: 1, total_cents: 792 },
    { name: 'Pudim', sku: null, unit_cost_cents: 693, quantity: 0, total_cents: 0 },
  ],
  ...over,
})

describe('validateLegacy — a historical settlement must add up before it is registered', () => {
  it('accepts lines whose quantity × cost is the line total and whose lines sum to the total', () => {
    expect(validateLegacy(valid({ total_cents: 22692 }))).toEqual([])
  })

  it('reports every problem at once, not only the first', () => {
    const problems = validateLegacy(valid({ period_to: '2026-09-10', paid_on: '2026-09-05', total_cents: 1, lines: [{ name: '', unit_cost_cents: -1, quantity: 1.5, total_cents: 5 }] }))

    expect(problems.length).toBeGreaterThanOrEqual(5)
  })

  it('refuses a line whose total is not quantity × cost', () => {
    const problems = validateLegacy(valid({ lines: [{ name: 'Pão de mel', unit_cost_cents: 730, quantity: 30, total_cents: 21000 }], total_cents: 21000 }))

    expect(problems).toContain('line "Pão de mel": 30 × 730 = 21900, not 21000')
  })

  it('refuses a total different from the sum of the lines', () => {
    expect(validateLegacy(valid({ total_cents: 22155 }))).toContain('total 22155 is not the sum of the lines (22692)')
  })

  it('refuses a payment date before the last covered day, and an inverted period', () => {
    expect(validateLegacy(valid({ total_cents: 22692, paid_on: '2026-09-28' }))).toContain('paid_on cannot be before the last covered day (2026-09-29)')
    expect(validateLegacy(valid({ total_cents: 22692, period_from: '2026-09-30', period_to: '2026-09-29' }))).toContain('period_to cannot be before period_from')
  })

  it('refuses no lines and impossible dates', () => {
    expect(validateLegacy(valid({ lines: [], total_cents: 0 }))).toContain('at least one line is required')
    expect(validateLegacy(valid({ total_cents: 22692, period_from: '2026-02-30' }))).toContain('period_from must be a real date, YYYY-MM-DD')
  })
})

describe('legacyInterval / legacyEvidence', () => {
  it('covers period_from through period_to, both included', () => {
    expect(legacyInterval(valid())).toEqual({ from: '2026-09-22', until: '2026-09-30' })
  })

  it('keeps the lines apart from `evidence.lines`, which the regular settlement reads, and says where it came from', () => {
    const evidence = legacyEvidence(valid({ total_cents: 22692, source: 'planilha do fornecedor', actor: 'dono@agiliz' }))

    expect(evidence.lines).toEqual([])
    expect(evidence.kind).toBe('legacy')
    expect(evidence.source).toBe('planilha do fornecedor')
    expect(evidence.registered_by).toBe('dono@agiliz')
    expect(evidence.legacy_lines).toHaveLength(3)
    expect(evidence.legacy_lines[0]).toEqual({ name: 'Pão de mel', sku: '110022', unit_cost_cents: 730, quantity: 30, total_cents: 21900 })
    expect(evidence.legacy_lines[2].sku).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- legacy-settlement`
Expected: FAIL, `Cannot find module './legacy-settlement'`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { DayInterval } from './settlement-coverage'
import { addDays, isDay } from './week'

export interface LegacyLineInput {
  name: string
  /** Null when the spreadsheet line has no SKU yet: the name is the identification, and nothing is guessed. */
  sku?: string | null
  unit_cost_cents: number
  quantity: number
  total_cents: number
}

export interface LegacyInput {
  /** First covered day, included. */
  period_from: string
  /** Last covered day, included. */
  period_to: string
  paid_on: string
  total_cents: number
  lines: LegacyLineInput[]
  source?: string
  actor?: string
}

/** What `settlement.evidence` holds for a historical settlement: `lines` stays empty so nothing that reads it is ever misled. */
export interface LegacyEvidence {
  kind: 'legacy'
  lines: []
  soldNotCovered: Record<string, never>
  quality: { salesUnknown: false; monthsWithoutDatedReceipts: []; storesMissing: 0 }
  formula: string
  source: string
  registered_by: string | null
  legacy_lines: Array<{ name: string; sku: string | null; unit_cost_cents: number; quantity: number; total_cents: number }>
}

const isCents = (value: number) => Number.isInteger(value) && value >= 0

/** Every problem at once; an empty list means the settlement can be registered. */
export function validateLegacy(input: LegacyInput): string[] {
  const problems: string[] = []

  if (!isDay(input.period_from)) problems.push('period_from must be a real date, YYYY-MM-DD')
  if (!isDay(input.period_to)) problems.push('period_to must be a real date, YYYY-MM-DD')
  if (!isDay(input.paid_on)) problems.push('paid_on must be a real date, YYYY-MM-DD')

  if (isDay(input.period_from) && isDay(input.period_to) && input.period_to < input.period_from) problems.push('period_to cannot be before period_from')
  if (isDay(input.period_to) && isDay(input.paid_on) && input.paid_on < input.period_to) problems.push(`paid_on cannot be before the last covered day (${input.period_to})`)

  if (input.lines.length === 0) problems.push('at least one line is required')

  let sum = 0
  for (const line of input.lines) {
    const label = line.name.trim() === '' ? 'a line without a name' : `line "${line.name}"`
    if (line.name.trim() === '') problems.push('every line needs a name')
    if (!Number.isInteger(line.quantity) || line.quantity < 0) problems.push(`${label}: quantity must be a whole number, zero or more`)
    if (!isCents(line.unit_cost_cents)) problems.push(`${label}: unit_cost_cents must be a whole number of cents, zero or more`)
    if (!isCents(line.total_cents)) problems.push(`${label}: total_cents must be a whole number of cents, zero or more`)
    if (Number.isInteger(line.quantity) && isCents(line.unit_cost_cents) && isCents(line.total_cents) && line.quantity * line.unit_cost_cents !== line.total_cents)
      problems.push(`${label}: ${line.quantity} × ${line.unit_cost_cents} = ${line.quantity * line.unit_cost_cents}, not ${line.total_cents}`)
    sum += Number.isFinite(line.total_cents) ? line.total_cents : 0
  }

  if (!isCents(input.total_cents)) problems.push('total_cents must be a whole number of cents, zero or more')
  else if (input.lines.length > 0 && sum !== input.total_cents) problems.push(`total ${input.total_cents} is not the sum of the lines (${sum})`)

  return problems
}

/** [period_from, period_to + 1 day): both selected days entirely. */
export function legacyInterval(input: LegacyInput): DayInterval {
  return { from: input.period_from, until: addDays(input.period_to, 1) }
}

export function legacyEvidence(input: LegacyInput): LegacyEvidence {
  return {
    kind: 'legacy',
    lines: [],
    soldNotCovered: {},
    quality: { salesUnknown: false, monthsWithoutDatedReceipts: [], storesMissing: 0 },
    formula: 'acerto histórico, já pago: quantidade × custo acordado, registrado a partir da planilha',
    source: input.source ?? 'planilha',
    registered_by: input.actor ?? null,
    legacy_lines: input.lines.map(line => ({ name: line.name, sku: line.sku ?? null, unit_cost_cents: line.unit_cost_cents, quantity: line.quantity, total_cents: line.total_cents })),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- legacy-settlement`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/utils/legacy-settlement.ts backend/apps/suppliers-service/src/modules/purchasing/utils/legacy-settlement.spec.ts
git commit -m "feat(suppliers): validation and evidence of a historical (legacy) settlement"
```

---

### Task 4: SettlementService — registrar, último acerto e travas de sobreposição

**Files:**
- Modify: `backend/apps/suppliers-service/src/modules/purchasing/services/settlement.service.ts`
- Create: `backend/apps/suppliers-service/src/modules/purchasing/dto/legacy-settlement.dto.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/services/settlement.service.spec.ts`

**Interfaces:**
- Consumes: `validateLegacy`, `legacyInterval`, `legacyEvidence`, `LegacyInput` (Task 3); `findOverlap`, `weekInterval`, `lastDay`, `DayInterval` (Task 2).
- Produces: `SettlementService.registerLegacy(dto: LegacySettlementDto): Promise<SettlementView>`; `SettlementService.last(supplierId: number): Promise<SettlementView | null>`; `SettlementView` ganha `kind: 'regular' | 'legacy'`, `period_from: string`, `period_to: string` (último dia incluso); `class LegacySettlementDto`.

- [ ] **Step 1: Write the DTO**

`dto/legacy-settlement.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator'

export class LegacyLineDto {
  @ApiProperty({ example: 'Pão de mel' })
  @IsString()
  @MaxLength(200)
  name: string

  @ApiPropertyOptional({ description: 'SKU do produto, quando conhecido. Nunca é adivinhado.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string | null

  @ApiProperty({ description: 'Custo de repasse por unidade, em centavos.' })
  @IsInt()
  @Min(0)
  unit_cost_cents: number

  @ApiProperty({ description: 'Unidades acertadas.' })
  @IsInt()
  @Min(0)
  quantity: number

  @ApiProperty({ description: 'quantidade × custo, em centavos.' })
  @IsInt()
  @Min(0)
  total_cents: number
}

export class LegacySettlementDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  supplier_id: number

  @ApiProperty({ description: 'Primeiro dia coberto (incluso).', example: '2026-09-22' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period_from: string

  @ApiProperty({ description: 'Último dia coberto (incluso).', example: '2026-09-29' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  period_to: string

  @ApiProperty({ example: '2026-09-30' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  paid_on: string

  @ApiProperty({ description: 'Total pago, em centavos; tem de ser a soma das linhas.' })
  @IsInt()
  @Min(0)
  total_cents: number

  @ApiProperty({ type: [LegacyLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LegacyLineDto)
  lines: LegacyLineDto[]

  @ApiPropertyOptional({ example: 'planilha do fornecedor' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string

  @ApiPropertyOptional({ description: 'Quem registrou (o gateway preenche com o usuário da sessão).' })
  @IsOptional()
  @IsString()
  actor?: string
}
```

- [ ] **Step 2: Write the failing service test**

`settlement.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { SettlementService } from './settlement.service'
import type { LegacySettlementDto } from '../dto/legacy-settlement.dto'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Just enough of Prisma for the settlement service: an in-memory `settlement` table and a supplier list. */
function fakePrisma(initial: Row[] = [], supplierIds = [7]) {
  const rows: Row[] = [...initial]
  const calls: { findMany: Row[] } = { findMany: [] }
  let nextId = 100
  const supplier = { id: 7, name: 'Fornecedor teste' }
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key])
      if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not
      return row[key] === value
    })

  return {
    rows,
    calls,
    supplier: { findUnique: async ({ where }: Row) => (supplierIds.includes(where.id) ? { ...supplier, id: where.id } : null) },
    purchase: { findMany: async () => [{ received_on: new Date('2026-09-01T00:00:00Z'), ordered_on: new Date('2026-09-01T00:00:00Z'), items: [{ id: 1, sku: 'A', quantity: 10, received_quantity: null, unit_cost_cents: 100 }] }] },
    settlement: {
      findMany: async ({ where }: Row = {}) => {
        calls.findMany.push(where ?? {})
        return rows.filter(row => matches(row, where))
      },
      findFirst: async ({ where, orderBy }: Row) => {
        const found = rows.filter(row => matches(row, where))
        const [field] = Object.keys((orderBy as Row[])[0])
        return found.sort((a, b) => b[field].getTime() - a[field].getTime() || b.id - a.id)[0] ?? null
      },
      findUnique: async ({ where }: Row) => rows.find(row => (where.id !== undefined ? row.id === where.id : row.supplier_id === where.supplier_id_week_start?.supplier_id && row.week_start.getTime() === where.supplier_id_week_start.week_start.getTime())) ?? null,
      create: async ({ data }: Row) => {
        const row = { id: nextId++, partial: false, confirmed_at: null, paid_on: null, payment_note: null, ...data, supplier }
        rows.push(row)
        return row
      },
      upsert: async ({ create }: Row) => {
        const row = { id: nextId++, ...create, confirmed_at: null, paid_on: null, payment_note: null, supplier }
        rows.push(row)
        return row
      },
      update: async ({ where, data }: Row) => Object.assign(rows.find(row => row.id === where.id) as Row, data, { supplier }),
    },
  }
}

const fakeSales = { soldBySku: async () => ({ from: '', to: '', rows: [], months_without_dated_receipts: [], stores_missing: 0 }) }
const service = (prisma = fakePrisma()) => ({ prisma, svc: new SettlementService(prisma as never, fakeSales as never) })

const dto = (over: Partial<LegacySettlementDto> = {}): LegacySettlementDto => ({
  supplier_id: 7,
  period_from: '2026-09-22',
  period_to: '2026-09-29',
  paid_on: '2026-09-30',
  total_cents: 22692,
  lines: [
    { name: 'Pão de mel', sku: '110022', unit_cost_cents: 730, quantity: 30, total_cents: 21900 },
    { name: 'Pizza de marguerita', sku: '9992', unit_cost_cents: 792, quantity: 1, total_cents: 792 },
  ],
  source: 'planilha',
  actor: 'dono@agiliz',
  ...over,
})

describe('SettlementService.registerLegacy', () => {
  it('stores a paid legacy settlement covering both selected days', async () => {
    const { svc } = service()

    const view = await svc.registerLegacy(dto())

    expect(view).toMatchObject({ kind: 'legacy', state: 'paid', owed_cents: 22692, period_from: '2026-09-22', period_to: '2026-09-29', paid_on: '2026-09-30', counts_as_owed: true })
  })

  it('refuses a settlement that does not add up, with the reasons', async () => {
    const { svc } = service()

    await expect(svc.registerLegacy(dto({ total_cents: 1 }))).rejects.toThrow(BadRequestException)
  })

  it('refuses an unknown supplier', async () => {
    const { svc } = service()

    await expect(svc.registerLegacy(dto({ supplier_id: 99 }))).rejects.toThrow(NotFoundException)
  })

  it('refuses days that an earlier confirmed or paid settlement already covers — nothing is charged twice', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())

    await expect(svc.registerLegacy(dto({ period_from: '2026-09-29', period_to: '2026-10-05', paid_on: '2026-10-06' }))).rejects.toThrow(ConflictException)
  })

  it('refuses the same settlement registered twice', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())

    await expect(svc.registerLegacy(dto())).rejects.toThrow(ConflictException)
  })
})

describe('SettlementService.last', () => {
  it('is the most recent confirmed or paid settlement by the last day it covers, never a proposal', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())
    await svc.registerLegacy(dto({ period_from: '2026-09-01', period_to: '2026-09-08', paid_on: '2026-09-09' }))

    const last = await svc.last(7)

    expect(last).toMatchObject({ period_from: '2026-09-22', period_to: '2026-09-29', kind: 'legacy' })
  })

  it('is null when the supplier has no confirmed or paid settlement', async () => {
    const { svc } = service()

    expect(await svc.last(7)).toBeNull()
  })
})

describe('SettlementService.propose — guards', () => {
  it('refuses a week that touches the days a legacy settlement already covers', async () => {
    const { svc } = service()
    await svc.registerLegacy(dto())

    await expect(svc.propose({ supplier_id: 7, week_start: '2026-09-21' })).rejects.toThrow(ConflictException)
  })

  it('reads the running balance only from REGULAR confirmed or paid settlements, so a legacy one never reaches it', async () => {
    const { svc, prisma } = service()
    await svc.registerLegacy(dto())

    await svc.propose({ supplier_id: 7, week_start: '2026-10-05' })

    const priorQuery = prisma.calls.findMany.find(where => where.kind === 'regular')
    expect(priorQuery).toBeDefined()
    expect(priorQuery?.state).toEqual({ in: ['confirmed', 'paid'] })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- settlement.service`
Expected: FAIL (`registerLegacy`/`last` não existem)

- [ ] **Step 4: Implement**

Em `settlement.service.ts`:

1. Imports (acrescentar ao bloco existente):

```ts
import type { LegacySettlementDto } from '../dto/legacy-settlement.dto'
import { legacyEvidence, legacyInterval, validateLegacy } from '../utils/legacy-settlement'
import { findOverlap, lastDay, weekInterval, type DayInterval } from '../utils/settlement-coverage'
```

2. `SettlementEvidence`: acrescentar, depois de `formula: string`, os campos opcionais do histórico:

```ts
  /** Só no acerto histórico (`kind = 'legacy'`): de onde veio e as linhas da planilha. `lines` fica vazio nele. */
  kind?: 'legacy'
  source?: string
  registered_by?: string | null
  legacy_lines?: Array<{ name: string; sku: string | null; unit_cost_cents: number; quantity: number; total_cents: number }>
```

3. `SettlementView`: acrescentar, depois de `week_end: string`:

```ts
  kind: 'regular' | 'legacy'
  /** Primeiro e último dia cobertos, ambos inclusos (dias de São Paulo). */
  period_from: string
  period_to: string
```

4. `Row` type: acrescentar `kind: string`, `period_start: Date`, `period_end: Date` e, em `toView`, dentro do objeto retornado, trocar `week_end: weekRange(start).to,` por:

```ts
    week_end: lastDay({ from: day(row.period_start) as string, until: day(row.period_end) as string }),
    kind: row.kind as 'regular' | 'legacy',
    period_from: day(row.period_start) as string,
    period_to: lastDay({ from: day(row.period_start) as string, until: day(row.period_end) as string }),
```

(e remover `weekRange` do import se deixar de ser usado em `toView`; `propose` ainda o usa.)

5. Em `propose`, logo depois da checagem `if (existing && existing.state !== 'proposal') throw ...`, acrescentar:

```ts
    await this.assertNoCoveredOverlap(dto.supplier_id, weekInterval(weekStart))
```

6. Em `confirm`, antes do `update`:

```ts
    await this.assertNoCoveredOverlap(row.supplier_id, { from: day(row.period_start) as string, until: day(row.period_end) as string }, id)
```

7. Em `priorLines`, trocar o `where` por:

```ts
      where: { supplier_id: supplierId, kind: 'regular', state: { in: ['confirmed', 'paid'] }, week_start: { lt: before } },
```

8. Novos métodos (antes de `private async get`):

```ts
  /**
   * Registers a settlement made outside the system (the spreadsheet): already paid, covering the selected days. It never enters the running balance
   * of regular settlements; its days can never be covered again by another confirmed or paid settlement of the supplier.
   */
  async registerLegacy(dto: LegacySettlementDto): Promise<SettlementView> {
    const problems = validateLegacy(dto)
    if (problems.length > 0) throw new BadRequestException(problems.join('; '))

    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplier_id } })
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplier_id} not found`)

    const interval = legacyInterval(dto)
    await this.assertNoCoveredOverlap(dto.supplier_id, interval)

    const date = (value: string) => new Date(`${value}T00:00:00Z`)
    try {
      const saved = await this.prisma.settlement.create({
        data: {
          supplier_id: dto.supplier_id,
          week_start: date(interval.from),
          period_start: date(interval.from),
          period_end: date(interval.until),
          kind: 'legacy',
          state: 'paid',
          owed_cents: dto.total_cents,
          partial: false,
          evidence: legacyEvidence(dto) as never,
          confirmed_at: date(dto.paid_on),
          paid_on: date(dto.paid_on),
          payment_note: dto.note,
        },
        include: { supplier: true },
      })

      return toView(saved)
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException(`A settlement of this supplier already starts on ${interval.from}`)
      throw error
    }
  }

  /** The most recent confirmed or paid settlement (a proposal is not a settlement yet), by the last day it covers. */
  async last(supplierId: number): Promise<SettlementView | null> {
    const row = await this.prisma.settlement.findFirst({
      where: { supplier_id: supplierId, state: { in: ['confirmed', 'paid'] } },
      orderBy: [{ period_end: 'desc' }, { id: 'desc' }],
      include: { supplier: true },
    })

    return row ? toView(row) : null
  }

  /** No new settlement may cover a day that another confirmed or paid settlement of the same supplier already covers. */
  private async assertNoCoveredOverlap(supplierId: number, interval: DayInterval, exceptId?: number): Promise<void> {
    const rows = await this.prisma.settlement.findMany({
      where: { supplier_id: supplierId, state: { in: ['confirmed', 'paid'] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, period_start: true, period_end: true },
    })
    const hit = findOverlap(interval, rows.map(r => ({ id: r.id, from: day(r.period_start) as string, until: day(r.period_end) as string })))
    if (hit !== null) throw new ConflictException(`Days from ${interval.from} are already covered by settlement ${hit}: the same sales cannot be settled twice`)
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- settlement.service`
Expected: PASS (9 tests). Depois `pnpm test` (suíte inteira) e `pnpm typecheck`: verdes.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/services/settlement.service.ts backend/apps/suppliers-service/src/modules/purchasing/services/settlement.service.spec.ts backend/apps/suppliers-service/src/modules/purchasing/dto/legacy-settlement.dto.ts
git commit -m "feat(suppliers): register a legacy settlement, last settlement, and overlap guards"
```

---

### Task 5: Rotas do suppliers-service e do gateway

**Files:**
- Modify: `backend/apps/suppliers-service/src/modules/purchasing/controllers/settlements.controller.ts`
- Modify: `backend/apps/gateway-service/src/modules/domains/controllers/purchases.controller.ts` (classe `SettlementsController`)

**Interfaces:**
- Consumes: `SettlementService.registerLegacy`, `SettlementService.last` (Task 4); `LegacySettlementDto`.
- Produces: `POST /settlements/legacy` (corpo `LegacySettlementDto`) → `SettlementView`; `GET /settlements/last?supplier_id=` → `{ settlement: SettlementView | null }`. Ambas declaradas **antes** de `@Get(':id')`. No gateway: `POST /settlements/legacy` (`suppliers:write`, injeta `actor`), `GET /settlements/last` (`suppliers:read`).

- [ ] **Step 1: suppliers-service controller**

Em `settlements.controller.ts`, importar `LegacySettlementDto` (`import { LegacySettlementDto } from '../dto/legacy-settlement.dto'`) e `Query` já existe. Inserir, **antes** de `@Get(':id')`:

```ts
  @Get('last')
  @ApiOperation({ summary: 'The last confirmed or paid settlement of a supplier, or null' })
  async last(@Query('supplier_id', ParseIntPipe) supplierId: number) {
    return { settlement: await this.settlements.last(supplierId) }
  }

  @Post('legacy')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Register a settlement made outside the system (spreadsheet), already paid',
    description: 'Covers period_from..period_to (both included). Refused if those days are already covered by a confirmed or paid settlement of the supplier.',
  })
  registerLegacy(@Body() dto: LegacySettlementDto) {
    return this.settlements.registerLegacy(dto)
  }
```

- [ ] **Step 2: gateway controller**

Em `purchases.controller.ts`, dentro de `SettlementsController`, **antes** de `@Get(':id')`:

```ts
  @Get('last')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'The last confirmed or paid settlement of a supplier' })
  async last(@Query() query: Record<string, string>, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: withQuery('/settlements/last', query), correlationId: correlationOf(request) })).data
  }

  @Post('legacy')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Register a settlement made outside the system, already paid' })
  async registerLegacy(@Body() body: unknown, @Caller() caller: AuthenticatedCaller, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: '/settlements/legacy', payload: asActor(body, caller), correlationId: correlationOf(request) })).data
  }
```

- [ ] **Step 3: Verify**

Run (em `backend/apps/suppliers-service` e depois em `backend/apps/gateway-service`): `pnpm typecheck && pnpm lint && pnpm test`
Expected: sem erros novos (lint só com os warnings que já existiam); suítes verdes.

Run (suppliers-service, banco descartável ainda no ar da Task 1): subir a app e chamar as duas rotas é coberto pelo teste de serviço da Task 4; aqui basta o `typecheck`, porque os controllers só delegam.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/suppliers-service/src/modules/purchasing/controllers/settlements.controller.ts backend/apps/gateway-service/src/modules/domains/controllers/purchases.controller.ts
git commit -m "feat(suppliers,gateway): routes to register a legacy settlement and read the last one"
```

---

### Task 6: Acordo e custos de repasse

**Files:**
- Create: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-agreement.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/utils/consignment-agreement.spec.ts`
- Create: `backend/apps/suppliers-service/src/modules/purchasing/dto/consignment.dto.ts`
- Create: `backend/apps/suppliers-service/src/modules/purchasing/services/consignment-agreement.service.ts`
- Test: `backend/apps/suppliers-service/src/modules/purchasing/services/consignment-agreement.service.spec.ts`
- Create: `backend/apps/suppliers-service/src/modules/purchasing/controllers/consignment.controller.ts`
- Modify: `backend/apps/suppliers-service/src/modules/purchasing/purchasing.module.ts`
- Modify: `backend/apps/gateway-service/src/modules/domains/controllers/purchases.controller.ts` (nova `ConsignmentController`) e `.../domains.module.ts` (registrar)

**Interfaces:**
- Produces (puro): `validatePeriodDays(days: number): string | null`; `validateCost(input: { sku: string; valid_from: string; unit_cost_cents: number }): string[]`; `currentCosts(costs: CostRow[], on: string): CostRow[]`; `interface CostRow { sku: string; valid_from: string; unit_cost_cents: number }`.
- Produces (serviço): `ConsignmentAgreementService.get(supplierId)`: `{ agreement: AgreementView | null; costs: CostRow[] }`; `.put(supplierId, dto)`: `AgreementView`; `.addCost(supplierId, dto)`: `CostRow`. Rotas `GET/PUT /consignment/agreements/:supplierId`, `POST /consignment/agreements/:supplierId/costs`.

- [ ] **Step 1: Write the failing pure test**

`consignment-agreement.spec.ts`:

```ts
import { currentCosts, validateCost, validatePeriodDays } from './consignment-agreement'

describe('validatePeriodDays — weekly, every 10, every 15 or a custom number of days', () => {
  it('accepts 7, 10, 15 and any whole number of days from 1 to 366', () => {
    for (const days of [7, 10, 15, 1, 21, 366]) expect(validatePeriodDays(days)).toBeNull()
  })

  it('refuses zero, negatives, fractions and more than a year', () => {
    for (const days of [0, -7, 7.5, 367]) expect(validatePeriodDays(days)).not.toBeNull()
  })
})

describe('validateCost', () => {
  it('accepts a SKU, a real start day and a whole number of cents', () => {
    expect(validateCost({ sku: '110022', valid_from: '2026-09-01', unit_cost_cents: 730 })).toEqual([])
  })

  it('reports every problem at once', () => {
    expect(validateCost({ sku: ' ', valid_from: '2026-02-30', unit_cost_cents: -5 }).length).toBe(3)
  })
})

describe('currentCosts — the cost in force on a day, per SKU', () => {
  const costs = [
    { sku: 'A', valid_from: '2026-09-01', unit_cost_cents: 730 },
    { sku: 'A', valid_from: '2026-10-05', unit_cost_cents: 760 },
    { sku: 'B', valid_from: '2026-11-01', unit_cost_cents: 100 },
  ]

  it('takes the latest vigência that has already started, and omits a SKU that has none yet', () => {
    expect(currentCosts(costs, '2026-10-04')).toEqual([{ sku: 'A', valid_from: '2026-09-01', unit_cost_cents: 730 }])
    expect(currentCosts(costs, '2026-10-05')).toEqual([{ sku: 'A', valid_from: '2026-10-05', unit_cost_cents: 760 }])
  })
})
```

- [ ] **Step 2: Run, see it fail**

Run: `pnpm test -- consignment-agreement`
Expected: FAIL, `Cannot find module './consignment-agreement'`

- [ ] **Step 3: Implement the pure rules**

```ts
import { isDay } from './week'

export interface CostRow {
  sku: string
  valid_from: string
  unit_cost_cents: number
}

/** Weekly (7), every 10 days, every 15 days or a custom number of days; at most one year. */
export function validatePeriodDays(days: number): string | null {
  return Number.isInteger(days) && days >= 1 && days <= 366 ? null : 'period_days must be a whole number of days from 1 to 366'
}

export function validateCost(input: { sku: string; valid_from: string; unit_cost_cents: number }): string[] {
  const problems: string[] = []
  if (input.sku.trim() === '') problems.push('sku is required')
  if (!isDay(input.valid_from)) problems.push('valid_from must be a real date, YYYY-MM-DD')
  if (!Number.isInteger(input.unit_cost_cents) || input.unit_cost_cents < 0) problems.push('unit_cost_cents must be a whole number of cents, zero or more')

  return problems
}

/** The agreed cost in force on `on` (a day), one per SKU; a SKU whose first vigência is still in the future is left out. */
export function currentCosts(costs: CostRow[], on: string): CostRow[] {
  const bySku = new Map<string, CostRow>()
  for (const cost of costs) {
    if (cost.valid_from > on) continue
    const held = bySku.get(cost.sku)
    if (!held || cost.valid_from > held.valid_from) bySku.set(cost.sku, cost)
  }

  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku))
}
```

- [ ] **Step 4: Run, see it pass**

Run: `pnpm test -- consignment-agreement`
Expected: PASS (6 tests)

- [ ] **Step 5: DTOs**

`dto/consignment.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'

export class PutAgreementDto {
  @ApiProperty({ description: '7, 10, 15 ou um número de dias personalizado.', example: 7 })
  @IsInt()
  @Min(1)
  period_days: number

  @ApiPropertyOptional({ description: 'Início do primeiro fechamento regular.', example: '2026-09-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  first_closing_on?: string
}

export class AddCostDto {
  @ApiProperty({ example: '110022' })
  @IsString()
  @MaxLength(60)
  sku: string

  @ApiProperty({ description: 'Dia em que o custo passa a valer.', example: '2026-09-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  valid_from: string

  @ApiProperty({ description: 'Custo de repasse por unidade, em centavos.' })
  @IsInt()
  @Min(0)
  unit_cost_cents: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string
}
```

- [ ] **Step 6: Write the failing service test**

`consignment-agreement.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ConsignmentAgreementService } from './consignment-agreement.service'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function fakePrisma() {
  const agreements: Row[] = []
  const costs: Row[] = []
  let nextId = 1
  return {
    agreements,
    costs,
    supplier: { findUnique: async ({ where }: Row) => (where.id === 7 ? { id: 7 } : null) },
    consignmentAgreement: {
      findUnique: async ({ where }: Row) => agreements.find(a => a.supplier_id === where.supplier_id) ?? null,
      upsert: async ({ where, create, update }: Row) => {
        const found = agreements.find(a => a.supplier_id === where.supplier_id)
        if (found) return Object.assign(found, update)
        const row = { id: nextId++, cost_basis: 'sale_date', ...create }
        agreements.push(row)
        return row
      },
    },
    consignmentCost: {
      findMany: async ({ where }: Row) => costs.filter(c => c.supplier_id === where.supplier_id),
      create: async ({ data }: Row) => {
        if (costs.some(c => c.supplier_id === data.supplier_id && c.sku === data.sku && c.valid_from.getTime() === data.valid_from.getTime())) throw Object.assign(new Error('unique'), { code: 'P2002' })
        const row = { id: nextId++, ...data }
        costs.push(row)
        return row
      },
    },
  }
}

const make = () => {
  const prisma = fakePrisma()
  return { prisma, svc: new ConsignmentAgreementService(prisma as never) }
}

describe('ConsignmentAgreementService', () => {
  it('has no agreement and no costs until one is registered', async () => {
    const { svc } = make()

    expect(await svc.get(7)).toEqual({ agreement: null, costs: [] })
  })

  it('stores the periodicity and the first closing day, and updates the same agreement', async () => {
    const { svc } = make()

    await svc.put(7, { period_days: 7, first_closing_on: '2026-09-30' })
    const again = await svc.put(7, { period_days: 10 })

    expect(again).toMatchObject({ supplier_id: 7, period_days: 10, cost_basis: 'sale_date' })
    expect((await svc.get(7)).agreement?.period_days).toBe(10)
  })

  it('refuses an impossible periodicity, and an unknown supplier', async () => {
    const { svc } = make()

    await expect(svc.put(7, { period_days: 0 })).rejects.toThrow(BadRequestException)
    await expect(svc.put(99, { period_days: 7 })).rejects.toThrow(NotFoundException)
  })

  it('adds costs as new vigências and never edits one: the same day twice is a conflict', async () => {
    const { svc } = make()

    await svc.addCost(7, { sku: '110022', valid_from: '2026-09-01', unit_cost_cents: 730 })
    await svc.addCost(7, { sku: '110022', valid_from: '2026-10-05', unit_cost_cents: 760 })

    await expect(svc.addCost(7, { sku: '110022', valid_from: '2026-09-01', unit_cost_cents: 999 })).rejects.toThrow(ConflictException)
    const { costs } = await svc.get(7)
    expect(costs.map(c => [c.valid_from, c.unit_cost_cents])).toEqual([['2026-09-01', 730], ['2026-10-05', 760]])
  })

  it('refuses a negative cost and an unreal start day', async () => {
    const { svc } = make()

    await expect(svc.addCost(7, { sku: 'A', valid_from: '2026-02-30', unit_cost_cents: -1 })).rejects.toThrow(BadRequestException)
  })
})
```

- [ ] **Step 7: Run, see it fail**

Run: `pnpm test -- consignment-agreement.service`
Expected: FAIL, `Cannot find module './consignment-agreement.service'`

- [ ] **Step 8: Implement the service**

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import type { AddCostDto, PutAgreementDto } from '../dto/consignment.dto'
import { validateCost, validatePeriodDays, type CostRow } from '../utils/consignment-agreement'
import { isDay } from '../utils/week'

export interface AgreementView {
  supplier_id: number
  period_days: number
  first_closing_on: string | null
  /** The only basis today: the agreed cost in force on the day of the sale. */
  cost_basis: 'sale_date'
}

const day = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null)
const date = (value: string) => new Date(`${value}T00:00:00Z`)

@Injectable()
export class ConsignmentAgreementService {
  constructor(private readonly prisma: PrismaClientService) {}

  async get(supplierId: number): Promise<{ agreement: AgreementView | null; costs: CostRow[] }> {
    const agreement = await this.prisma.consignmentAgreement.findUnique({ where: { supplier_id: supplierId } })
    const costs = await this.prisma.consignmentCost.findMany({ where: { supplier_id: supplierId }, orderBy: [{ sku: 'asc' }, { valid_from: 'asc' }] })

    return {
      agreement: agreement ? toAgreement(agreement) : null,
      costs: costs.map(c => ({ sku: c.sku, valid_from: day(c.valid_from) as string, unit_cost_cents: c.unit_cost_cents })),
    }
  }

  async put(supplierId: number, dto: PutAgreementDto): Promise<AgreementView> {
    const problem = validatePeriodDays(dto.period_days)
    if (problem) throw new BadRequestException(problem)
    if (dto.first_closing_on !== undefined && !isDay(dto.first_closing_on)) throw new BadRequestException('first_closing_on must be a real date, YYYY-MM-DD')
    await this.assertSupplier(supplierId)

    const first = dto.first_closing_on === undefined ? {} : { first_closing_on: date(dto.first_closing_on) }
    const saved = await this.prisma.consignmentAgreement.upsert({
      where: { supplier_id: supplierId },
      create: { supplier_id: supplierId, period_days: dto.period_days, ...first },
      update: { period_days: dto.period_days, ...first },
    })

    return toAgreement(saved)
  }

  /** A cost is never edited or removed: a correction is another vigência. */
  async addCost(supplierId: number, dto: AddCostDto): Promise<CostRow> {
    const problems = validateCost(dto)
    if (problems.length > 0) throw new BadRequestException(problems.join('; '))
    await this.assertSupplier(supplierId)

    try {
      const saved = await this.prisma.consignmentCost.create({ data: { supplier_id: supplierId, sku: dto.sku.trim(), valid_from: date(dto.valid_from), unit_cost_cents: dto.unit_cost_cents, note: dto.note } })

      return { sku: saved.sku, valid_from: day(saved.valid_from) as string, unit_cost_cents: saved.unit_cost_cents }
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException(`${dto.sku} already has a cost starting on ${dto.valid_from}: add a later vigência instead of changing it`)
      throw error
    }
  }

  private async assertSupplier(supplierId: number) {
    if (!(await this.prisma.supplier.findUnique({ where: { id: supplierId } }))) throw new NotFoundException(`Supplier ${supplierId} not found`)
  }
}

function toAgreement(row: { supplier_id: number; period_days: number; first_closing_on: Date | null }): AgreementView {
  return { supplier_id: row.supplier_id, period_days: row.period_days, first_closing_on: day(row.first_closing_on), cost_basis: 'sale_date' }
}
```

- [ ] **Step 9: Run, see it pass**

Run: `pnpm test -- consignment-agreement`
Expected: PASS (11 tests nos dois arquivos).

- [ ] **Step 10: Controller, module and gateway**

`controllers/consignment.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AddCostDto, PutAgreementDto } from '../dto/consignment.dto'
import { ConsignmentAgreementService } from '../services/consignment-agreement.service'

@ApiTags('consignment')
@Controller('consignment/agreements')
export class ConsignmentController {
  constructor(private readonly agreements: ConsignmentAgreementService) {}

  @Get(':supplierId')
  @ApiOperation({ summary: 'The consignment agreement of a supplier and every cost vigência' })
  get(@Param('supplierId', ParseIntPipe) supplierId: number) {
    return this.agreements.get(supplierId)
  }

  @Put(':supplierId')
  @ApiOperation({ summary: 'Set the periodicity and first closing day of a supplier\'s consignment' })
  put(@Param('supplierId', ParseIntPipe) supplierId: number, @Body() dto: PutAgreementDto) {
    return this.agreements.put(supplierId, dto)
  }

  @Post(':supplierId/costs')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a cost vigência for a SKU; never edits an earlier one' })
  addCost(@Param('supplierId', ParseIntPipe) supplierId: number, @Body() dto: AddCostDto) {
    return this.agreements.addCost(supplierId, dto)
  }
}
```

Em `purchasing.module.ts`: importar `ConsignmentController` e `ConsignmentAgreementService`; acrescentar `ConsignmentController` em `controllers` e `ConsignmentAgreementService` em `providers`.

No gateway, em `purchases.controller.ts`, acrescentar ao fim do arquivo:

```ts
/** Consignment agreement and agreed costs (suppliers-service). Reading needs `suppliers:read`; changing, `suppliers:write`. */
@ApiTags('consignment')
@Controller('consignment/agreements')
export class ConsignmentController {
  constructor(private readonly domains: DomainClient) {}

  @Get(':supplierId')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_READ)
  @ApiOperation({ summary: 'The consignment agreement of a supplier and its costs' })
  async get(@Param('supplierId') supplierId: string, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'get', path: `/consignment/agreements/${encodeURIComponent(supplierId)}`, correlationId: correlationOf(request) })).data
  }

  @Put(':supplierId')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Set the periodicity and first closing day' })
  async put(@Param('supplierId') supplierId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'put', path: `/consignment/agreements/${encodeURIComponent(supplierId)}`, payload: body, correlationId: correlationOf(request) })).data
  }

  @Post(':supplierId/costs')
  @RequiresPermission(PERMISSIONS.SUPPLIERS_WRITE)
  @ApiOperation({ summary: 'Add a cost vigência' })
  async addCost(@Param('supplierId') supplierId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return (await this.domains.suppliers({ method: 'post', path: `/consignment/agreements/${encodeURIComponent(supplierId)}/costs`, payload: body, correlationId: correlationOf(request) })).data
  }
}
```

Acrescentar `Put` ao import de `@nestjs/common` do arquivo se ainda não estiver. Em `domains.module.ts`: importar `ConsignmentController` da linha `import { PayablesController, PurchasesController, SettlementsController } from './controllers/purchases.controller'` (somando `ConsignmentController`) e acrescentá-lo à lista de controllers (junto de `SettlementsController, PayablesController,`). Se `DomainClient.suppliers` não aceitar `method: 'put'`, ampliar a união de métodos no `DomainClient` do gateway (procurar a definição do tipo de `method` e incluir `'put'`), com um teste de uma linha no spec existente do client, se houver.

- [ ] **Step 11: Verify**

Run (em cada serviço): `pnpm typecheck && pnpm lint && pnpm test`
Expected: sem erros novos; suítes verdes.

- [ ] **Step 12: Commit**

```bash
git add backend/apps/suppliers-service backend/apps/gateway-service
git commit -m "feat(suppliers,gateway): consignment agreement (periodicity, first closing) and append-only cost vigências"
```

---

### Task 7: Admin — último acerto e acerto histórico na tela

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/purchases.ts` (tipos e endpoint)
- Modify: `frontend/apps/admin/src/components/purchases/settlement-screen.tsx`
- Modify: `frontend/apps/admin/src/components/purchases/purchases.spec.tsx`

**Interfaces:**
- Consumes: `GET /settlements/last?supplier_id=` → `{ settlement: Settlement | null }`; `Settlement` com `kind`, `period_from`, `period_to` e `evidence.legacy_lines` (Tasks 4 e 5).
- Produces: `useGetLastSettlementQuery({ supplierId }, { skip })`; tipo `LegacyLine`; `Settlement.kind: "regular" | "legacy"`.

- [ ] **Step 1: Write the failing tests**

Em `purchases.spec.tsx`: no objeto `settlement` de fixture, acrescentar `kind: "regular", period_from: "2026-10-05", period_to: "2026-10-11",` (depois de `week_end`). No `jest.doMock("../../lib/api/purchases", ...)` acrescentar:

```ts
  useGetLastSettlementQuery: (arg: { supplierId: number }) => ({ data: { settlement: lastSettlement[arg.supplierId] ?? null } }),
```

e, antes do `doMock`, declarar:

```ts
const legacySettlement = {
  id: 9, supplier_id: 6, supplier_name: "Doces e congelados", week_start: "2026-09-22", week_end: "2026-09-29", kind: "legacy", period_from: "2026-09-22", period_to: "2026-09-29",
  state: "paid", counts_as_owed: true, owed_cents: 69711, partial: false,
  evidence: { lines: [], soldNotCovered: {}, quality: { salesUnknown: false, monthsWithoutDatedReceipts: [], storesMissing: 0 }, formula: "acerto histórico", kind: "legacy", source: "planilha", legacy_lines: [{ name: "Pão de mel", sku: "110022", unit_cost_cents: 730, quantity: 30, total_cents: 21900 }, { name: "Pudim", sku: null, unit_cost_cents: 693, quantity: 0, total_cents: 0 }] },
  confirmed_at: "2026-09-30T00:00:00.000Z", paid_on: "2026-09-30", payment_note: null,
};
const lastSettlement: Record<number, unknown> = { 6: legacySettlement };
```

No mock `useGetSettlementsQuery`, trocar por `useGetSettlementsQuery: () => ({ data: [settlement, legacySettlement] }),`.

Acrescentar ao `describe("SettlementScreen — escolha do fornecedor", ...)`:

```ts
  it("mostra a data do último acerto do fornecedor escolhido", () => {
    render(<SettlementScreen />);
    fireEvent.change(screen.getByLabelText("Fornecedor do acerto"), { target: { value: "6" } });

    const last = screen.getByTestId("last-settlement");
    expect(last).toHaveTextContent("22/09/2026 a 29/09/2026");
    expect(last).toHaveTextContent("pago em 30/09/2026");
    expect(last).toHaveTextContent("R$ 697,11");
  });

  it("fornecedor sem acerto confirmado diz isso, sem inventar data", () => {
    render(<SettlementScreen />);
    fireEvent.change(screen.getByLabelText("Fornecedor do acerto"), { target: { value: "5" } });

    expect(screen.getByTestId("last-settlement")).toHaveTextContent("Nenhum acerto confirmado ainda");
  });
```

e um novo `describe`:

```ts
describe("SettlementScreen — acerto histórico", () => {
  it("lista o acerto histórico com o período e abre as linhas da planilha, sem a tela de proposta", () => {
    render(<SettlementScreen />);

    expect(screen.getAllByText("22/09/2026 a 29/09/2026").length).toBeGreaterThan(0);
    expect(screen.getByText("Histórico")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Abrir" })[1]);

    expect(screen.getByText("Pão de mel")).toBeInTheDocument();
    expect(screen.getByText("Acerto histórico (já pago)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar acerto" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, see it fail**

Run (em `frontend/apps/admin`): `pnpm exec jest src/components/purchases/purchases.spec.tsx`
Expected: FAIL (`last-settlement` e o histórico ainda não existem).

- [ ] **Step 3: Types and endpoint**

Em `lib/api/purchases.ts`:

1. Acima de `export interface Settlement`, acrescentar:

```ts
export interface LegacyLine {
  name: string;
  sku: string | null;
  unit_cost_cents: number;
  quantity: number;
  total_cents: number;
}
```

2. No `Settlement`: depois de `week_end: string;` acrescentar `kind: "regular" | "legacy"; /** Primeiro e último dia cobertos, ambos inclusos. */ period_from: string; period_to: string;`; e no `evidence`, depois de `formula: string;` acrescentar `source?: string; legacy_lines?: LegacyLine[];`.

3. No `builder` (junto de `getOpenTotal`), acrescentar:

```ts
    getLastSettlement: builder.query<{ settlement: Settlement | null }, { supplierId: number }>({
      query: ({ supplierId }) => `/settlements/last?supplier_id=${supplierId}`,
      providesTags: ["Settlement"],
    }),
```

e exportar `useGetLastSettlementQuery` na lista de hooks exportados (onde estão `useGetOpenTotalQuery` e vizinhos).

- [ ] **Step 4: The screen**

Em `settlement-screen.tsx`:

1. Importar `useGetLastSettlementQuery` e o tipo `LegacyLine` junto dos imports de `@/lib/api/purchases`.

2. Componentes novos (acima de `SettlementScreen`):

```tsx
/** A data do último acerto confirmado ou pago do fornecedor: de onde parte o próximo. */
function LastSettlementLine({ supplierId }: { supplierId: number }) {
  const { data } = useGetLastSettlementQuery({ supplierId });
  const last = data?.settlement;

  return (
    <p data-testid="last-settlement" className="text-sm text-muted-foreground">
      {last
        ? `Último acerto: ${formatDate(last.period_from)} a ${formatDate(last.period_to)} · ${last.state === "paid" ? `pago em ${formatDate(last.paid_on)}` : "confirmado, aguardando pagamento"} · ${formatCents(last.owed_cents)}${last.kind === "legacy" ? " · histórico" : ""}`
        : "Nenhum acerto confirmado ainda para este fornecedor."}
    </p>
  );
}

/** Acerto feito fora do sistema (planilha): já pago, só consulta. */
function LegacySettlementCard({ settlement }: { settlement: Settlement }) {
  const lines: LegacyLine[] = settlement.evidence.legacy_lines ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {settlement.supplier_name} · {formatDate(settlement.period_from)} a {formatDate(settlement.period_to)}
          </CardTitle>
          <StatusBadge tone="positive">Acerto histórico (já pago)</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          Pago em {formatDate(settlement.paid_on)} · {formatCents(settlement.owed_cents)} · origem: {settlement.evidence.source ?? "planilha"}
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Custo</TableHead>
              <TableHead className="text-right">Quantidade</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={`${line.name}-${line.sku ?? ""}`}>
                <TableCell>{line.name}</TableCell>
                <TableCell className="tabular text-right">{formatCents(line.unit_cost_cents)}</TableCell>
                <TableCell className="tabular text-right">{line.quantity}</TableCell>
                <TableCell className="tabular text-right">{formatCents(line.total_cents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

3. Dentro de `SettlementScreen`, logo depois do `Card` do filtro e antes do aviso `no-consigned-notice`, acrescentar:

```tsx
      {chosen && <LastSettlementLine supplierId={chosen.id} />}
```

4. Trocar o início do bloco do acerto aberto, `{current && (` (o `Card` com `current.supplier_name · semana …`), por:

```tsx
      {current && current.kind === "legacy" && <LegacySettlementCard settlement={current} />}

      {current && current.kind !== "legacy" && (
```

5. Na tabela "Acertos anteriores": trocar `<TableHead>Semana</TableHead>` por `<TableHead>Período</TableHead>`, depois de `<TableHead>Estado</TableHead>` acrescentar `<TableHead>Pago em</TableHead>`; trocar a célula `<TableCell className="tabular">{formatDate(settlement.week_start)}</TableCell>` por `<TableCell className="tabular">{formatDate(settlement.period_from)} a {formatDate(settlement.period_to)}</TableCell>`; depois da célula do estado acrescentar `<TableCell className="tabular">{settlement.paid_on ? formatDate(settlement.paid_on) : "—"}</TableCell>`; e dentro da célula do estado, depois do selo `partial`, acrescentar `{settlement.kind === "legacy" && <span className="ml-2 text-xs text-muted-foreground">Histórico</span>}`.

6. Em `open(settlement)`, nada muda (a tela de proposta só aparece para `kind !== "legacy"`).

- [ ] **Step 5: Run, see it pass**

Run: `pnpm exec jest src/components/purchases src/lib/purchases`
Expected: PASS. Depois `pnpm typecheck && pnpm lint` (0 erros) e a suíte completa do admin: o `new-product-panel.spec` é instável sob carga (passa isolado); qualquer outra falha é nova e precisa ser resolvida.

- [ ] **Step 6: Commit**

```bash
git add frontend/apps/admin/src/lib/api/purchases.ts frontend/apps/admin/src/components/purchases/settlement-screen.tsx frontend/apps/admin/src/components/purchases/purchases.spec.tsx
git commit -m "feat(admin): last settlement date and legacy settlement view on the settlement screen"
```

---

### Task 8: Registrar o acerto real de 22/09 a 29/09 (somente com a aprovação do dono)

**Files:**
- Create: `docs/superpowers/data/2026-09-22-consignment-settlement.json`

Esta task **escreve no banco real de desenvolvimento** (dado real do dono, não sintético). Não executar sem o "sim" explícito dele na hora, e depois de ele escolher o fornecedor e confirmar os SKUs.

- [ ] **Step 1: Ask the owner**

Perguntar: (a) qual fornecedor é este (candidatos no cadastro: `64 Eze Creperie Fábrica de Congelados`, `67 Lu Torelli Doces Artesanais`, `81 Super Doce`, `141 doceria da mata`, ou outro); (b) os SKUs das três linhas sem venda (pizza de calabresa, pudim, empanada unitária): `9993`, `100065` ou `5055`, `100063`; e (c) o "sim" para registrar.

- [ ] **Step 2: Write the data file**

`docs/superpowers/data/2026-09-22-consignment-settlement.json` (SKUs conferidos contra as vendas: 13 produtos batem exato; "Chocolate ao leite divino vicio" teve 1 venda no sistema e 0 na planilha, e a planilha vale):

```json
{
  "supplier_id": 0,
  "period_from": "2026-09-22",
  "period_to": "2026-09-29",
  "paid_on": "2026-09-30",
  "total_cents": 69711,
  "source": "planilha de acerto do fornecedor (22/09 a 29/09/2026)",
  "note": "Pago em 30/09/2026. Registro histórico: o acerto foi feito fora do sistema.",
  "lines": [
    { "name": "Pizza de marguerita", "sku": "9992", "unit_cost_cents": 792, "quantity": 1, "total_cents": 792 },
    { "name": "Pizza de calabresa", "sku": null, "unit_cost_cents": 792, "quantity": 0, "total_cents": 0 },
    { "name": "Pudim", "sku": null, "unit_cost_cents": 693, "quantity": 0, "total_cents": 0 },
    { "name": "Pão de queijo", "sku": "6015", "unit_cost_cents": 1323, "quantity": 1, "total_cents": 1323 },
    { "name": "Empanada unitária", "sku": null, "unit_cost_cents": 747, "quantity": 0, "total_cents": 0 },
    { "name": "Pão de mel", "sku": "110022", "unit_cost_cents": 730, "quantity": 30, "total_cents": 21900 },
    { "name": "Cone trufado", "sku": "100083", "unit_cost_cents": 595, "quantity": 29, "total_cents": 17255 },
    { "name": "Torta de frango", "sku": "100100", "unit_cost_cents": 996, "quantity": 5, "total_cents": 4980 },
    { "name": "Pão de batata", "sku": "100101", "unit_cost_cents": 780, "quantity": 4, "total_cents": 3120 },
    { "name": "Leite em pó doce gourmet avelã branco", "sku": "100099", "unit_cost_cents": 227, "quantity": 24, "total_cents": 5448 },
    { "name": "Leite em pó doce gourmet avelã chocolate", "sku": "100098", "unit_cost_cents": 266, "quantity": 39, "total_cents": 10374 },
    { "name": "Leite em pó doce gourmet tradicional", "sku": "100102", "unit_cost_cents": 227, "quantity": 2, "total_cents": 454 },
    { "name": "Quiche Loran", "sku": "100109", "unit_cost_cents": 837, "quantity": 2, "total_cents": 1674 },
    { "name": "Pão de queijo unitário", "sku": "100037", "unit_cost_cents": 657, "quantity": 3, "total_cents": 1971 },
    { "name": "Choco blank divino", "sku": "100106", "unit_cost_cents": 140, "quantity": 2, "total_cents": 280 },
    { "name": "Chocolate ao leite divino vicio", "sku": "100107", "unit_cost_cents": 140, "quantity": 0, "total_cents": 0 },
    { "name": "Chocolate ao leite amendoim desejo", "sku": "100108", "unit_cost_cents": 140, "quantity": 1, "total_cents": 140 }
  ]
}
```

Substituir `"supplier_id": 0` pelo id escolhido e as linhas com `"sku": null` pelos SKUs confirmados. A soma das linhas é 69.711 centavos (R$ 697,11): o serviço recusa se não fechar.

- [ ] **Step 3: Register through the running service**

Com o stack de dev no ar e o `agiliz-suppliers-dev` já com a migração da Task 1 aplicada (ele roda `prisma migrate deploy` ao subir: reiniciar o contêiner depois do merge):

```bash
docker cp docs/superpowers/data/2026-09-22-consignment-settlement.json agiliz-suppliers-dev:/tmp/legacy.json
docker exec agiliz-suppliers-dev wget -qO- --header 'Content-Type: application/json' --post-file=/tmp/legacy.json http://localhost:3000/settlements/legacy
```

Expected: JSON com `"kind":"legacy"`, `"state":"paid"`, `"owed_cents":69711`, `"period_from":"2026-09-22"`, `"period_to":"2026-09-29"`. Rodar de novo deve dar `409` (não duplica).

- [ ] **Step 4: Verify on the screen**

Abrir Compras → Acerto semanal, escolher o fornecedor: deve aparecer "Último acerto: 22/09/2026 a 29/09/2026 · pago em 30/09/2026 · R$ 697,11 · histórico" e a linha na tabela "Acertos anteriores", que abre as 14 linhas. Tentar calcular uma proposta da semana de 21/09 deve ser recusado (409).

- [ ] **Step 5: Record the custo vigente (optional, same approval)**

Se o dono confirmar a data de início dos custos de repasse, registrar cada um pela rota nova (um `POST /consignment/agreements/<supplier_id>/costs` por SKU com `{ "sku", "valid_from", "unit_cost_cents" }`, usando os custos da planilha). Não inventar a data: perguntar.

- [ ] **Step 6: Commit the data file**

```bash
git add docs/superpowers/data/2026-09-22-consignment-settlement.json
git commit -m "docs: data of the 22/09-29/09/2026 consignment settlement (registered as a legacy settlement)"
```

---

### Task 9: Documentação do serviço

**Files:**
- Modify: `backend/apps/suppliers-service/CLAUDE.md`
- Modify: `frontend/apps/admin/CLAUDE.md`

- [ ] **Step 1: suppliers-service CLAUDE.md** — acrescentar ao fim, no formato das seções existentes:

```markdown
## Fase 2a do fechamento de consignação: acerto histórico, acordo e custos

`settlement` ganhou `kind` (`regular`/`legacy`) e `period_start`/`period_end` (dias de São Paulo, fim exclusivo). **Acerto histórico** (`POST /settlements/legacy`) é o que foi feito fora do sistema (planilha): nasce `paid`, cobre `period_from..period_to` (ambos inclusos), e a soma das linhas tem de fechar com o total (`utils/legacy-settlement.ts`, todos os problemas de uma vez). **Nunca entra no saldo corrido dos regulares**: `priorLines` só lê `kind = 'regular'` e a evidência histórica guarda as linhas em `legacy_lines` (`lines` fica vazio). **Nenhum acerto confirmado/pago pode cobrir dias já cobertos por outro do mesmo fornecedor** (`utils/settlement-coverage.ts`; `propose`, `confirm` e `registerLegacy` dão 409): é o que impede cobrar duas vezes a mesma venda. `GET /settlements/last?supplier_id=` devolve `{ settlement }` do último confirmado/pago por último dia coberto, ou `null`. `consignment_agreement` (periodicidade 7/10/15/personalizada, primeiro fechamento, `cost_basis` sempre `sale_date`) e `consignment_cost` (custo por SKU com vigência, **append-only**: corrigir é outra vigência) em `/consignment/agreements/:supplierId`. O razão de estoque (movimentos, saldo inicial, recebimento, transferência, baixa e devolução) é a Fase 2b.
```

- [ ] **Step 2: admin CLAUDE.md** — no parágrafo "Compras: pedidos, notas e acerto", depois da frase do seletor de fornecedor, acrescentar: `A tela mostra o **último acerto** do fornecedor escolhido (período coberto, pago em, valor; "Nenhum acerto confirmado ainda" sem data inventada) e abre o **acerto histórico** (planilha, já pago, só consulta) sem a tela de proposta; a tabela "Acertos anteriores" mostra o período coberto e quando foi pago.`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/suppliers-service/CLAUDE.md frontend/apps/admin/CLAUDE.md
git commit -m "docs: consignment phase 2a (legacy settlement, last settlement, agreement and costs)"
```
