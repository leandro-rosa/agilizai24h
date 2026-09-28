# Abastecimento Inteligente & Mix — Revisão Operacional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the Abastecimento Inteligente and Mix das Lojas tables in real operational data — parametrização atual (nível de par / mínimo crítico, sourced from real Drive planograma reports), Abastecido × Vendido × Perdido with an explicit window, aproveitamento, embalagem/fracionamento — while keeping every existing safety constraint (never infer current stock, always show a range, Loss Intelligence precedence unchanged) intact.

**Architecture:** Extend the existing, already-shipped `inventory-service.MinimumLevel` table (Produto × Loja, currently empty in production) with two new fields instead of a new service. Add three packaging fields directly to `products-service`'s `Product` model. Thread both into the existing `restock/engine.ts` and `mix/engine.ts` as new, purely additive inputs/outputs — no existing field is renamed or removed, no existing precedence rule changes. A one-time, human-reviewed import populates the new fields from 20 real Drive files; going forward the operator maintains them through new admin UI built in this plan.

**Tech Stack:** NestJS + Prisma (inventory-service, products-service, gateway-service), Next.js + RTK Query + Jest (frontend/apps/admin), `xlsx`/`readWorkbookRows` (ingestion-worker-service) for the one-time import.

**Spec:** `docs/superpowers/specs/2026-09-24-restock-mix-operational-revision-design.md` (audit + proposal, fully approved by the operator including the real Drive file structure, the store-matching algorithm, and the decision to keep `quant. atual` reference-only for this revision).

## Global Constraints

- **Nunca inferir estoque atual por subtração** (`abastecido − vendido − perdido`) — unchanged from the original feature. The new `current_quantity` field is an **observed** value from the planograma report, never computed.
- **`current_quantity`/`quantidadeAtual` never feeds `quantidadeSugeridaIA`, `faixaEstimada`, or `deltaVsParametrizado`** — reference-only in the drawer, per the operator's explicit 2026-09-24 decision. Reformulating the formula to `reposição = nível de par − quantidade atual` is explicitly **out of scope** for this plan.
- **Toda quantidade sugerida sempre com faixa, nunca só um ponto** — unchanged. The new rounding-lean logic (Task 6) only chooses where inside the already-computed `faixaEstimada` the operational suggestion sits; it never changes `faixaEstimada` itself.
- **Loss Intelligence precedence is unchanged** — Tasks 6/7 only add new fields to the recommendation objects; they never touch the existing tier 1/2/3/4 branching logic in `restock/engine.ts` or the classification branching in `mix/engine.ts`.
- **`inventory-service` has no authorization of its own** — enforcement is the gateway's job (`@RequiresPermission`), same as every existing route there.
- **Nenhuma ação consequente sem aprovação humana explícita** — the one-time bulk import (Task 15's real-file run) is never automated inside the task loop; it is a manual, reviewed step with an explicit dry-run before any write, executed by the controller/operator after Task 15's code is merged, documented as its own final section below.
- **Old 6-tab commercial-intelligence engine untouched** — no task in this plan touches `frontend/apps/admin/src/lib/commercial-intelligence/` outside `restock-mix/`, per the standing constraint from the original plan.
- **Migration naming**: `inventory-service` and `products-service` both use `YYYYMMDDHHMMSS_snake_case_description` — new migrations must follow this exact pattern (verified against `backend/apps/inventory-service/prisma/migrations/` and `backend/apps/products-service/prisma/migrations/`).
- **Synthetic-data isolation**: every new test (backend or frontend) uses synthetic fixtures built by hand in the test file — never real SKU/store data, never the real 20 Drive files, even for the import-matching logic's tests (Task 15).

## Review Focus

- **A SKU with a configured `par_level` but zero sales history** (evidence gate fires, `acao: "dados_insuficientes"`) — a reasonable operator would still expect to see the parametrização and delta columns populated (they know their own parametrização regardless of the engine's confidence), not blanked out just because the evidence gate fired. Task 6's tests cover this.
- **A store×SKU with a `MinimumLevel` row that has `minimum` set but `par_level`/`current_quantity` still `null`** (partial data, e.g. before the operator has gotten around to setting a par level for that SKU) — the UI must show "—" for the missing pieces individually, never hide the whole row or show a fabricated 0. Task 10/12's tests cover this.
- **The bulk import re-run for a store that already has rows** (e.g. the operator re-imports after fixing a mistake) — must overwrite cleanly via upsert, not create duplicate rows or silently skip. Task 1's tests cover this explicitly.
- **A product whose `shelf_life_days` is `null`** (most of the 232 existing products, since it's an optional field never bulk-populated) — the rounding-lean logic in Task 6 must not treat `null` shelf life as "short shelf life"; only an actual number `<= threshold` triggers the lean. Task 6's tests cover this.
- **The Drive filename-matching algorithm given a filename with NO matching store at all** (not just the known HTL05 case, but the general case for any future re-run) — must report an explicit "no match" result rather than silently picking the wrong store or crashing. Task 15's tests cover this as a first-class case, not just the one hardcoded exception.

---

## File Structure

**Backend — `inventory-service`** (extend, no new files except the migration):
- `backend/apps/inventory-service/prisma/schema.prisma` — extend `MinimumLevel`.
- `backend/apps/inventory-service/prisma/migrations/<ts>_minimum_level_par_and_current_quantity/migration.sql` — new.
- `backend/apps/inventory-service/src/modules/inventory/controllers/inventory.controller.ts` — new DTOs, new routes.
- `backend/apps/inventory-service/src/modules/inventory/services/inventory.service.ts` — new/widened service methods.
- `backend/apps/inventory-service/test/inventory.integration-spec.ts` — new tests (existing file).

**Backend — `products-service`** (extend, no new files except the migration):
- `backend/apps/products-service/prisma/schema.prisma` — extend `Product`.
- `backend/apps/products-service/prisma/migrations/<ts>_product_packaging_fields/migration.sql` — new.
- Products DTO/service/controller files — extend (exact paths confirmed inside Task 2).

**Backend — `gateway-service`** (extend, no new files):
- `backend/apps/gateway-service/src/modules/domains/controllers/inventory.controller.ts` — new proxy routes.
- `backend/apps/gateway-service/src/modules/domains/controllers/products.controller.ts` — new proxy route.

**Backend — `ingestion-worker-service`** (new module, isolated from the recurring pipeline):
- `backend/apps/ingestion-worker-service/src/modules/ingestion/utils/row-mapping.ts` — extend `COLUMN_ALIASES` with 2 new keys.
- `backend/apps/ingestion-worker-service/src/modules/planogram-import/store-matcher.ts` — new, pure function.
- `backend/apps/ingestion-worker-service/src/modules/planogram-import/store-matcher.spec.ts` — new.
- `backend/apps/ingestion-worker-service/src/modules/planogram-import/parse-planograma-row.ts` — new, pure function.
- `backend/apps/ingestion-worker-service/src/modules/planogram-import/parse-planograma-row.spec.ts` — new.

**Frontend — API layer** (extend):
- `frontend/apps/admin/src/lib/api/inventory.ts` — widen `StockItem`, new hooks.
- `frontend/apps/admin/src/lib/api/products.ts` — widen `Product`, new hook.

**Frontend — restock-mix engine** (extend):
- `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/types.ts` — new `StoreSkuParametrizacao` type, widen `RestockRecommendation`/`MixRecommendation`.
- `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/parameters.ts`, `parameter-docs.ts`, `env.ts`, `parameter-rows.ts` — new `rounding` parameter group.
- `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/engine.ts` — new inputs/outputs, rounding lean.
- `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/mix/engine.ts` — new inputs/outputs.
- Corresponding `.spec.ts` files — extend.

**Frontend — UI** (extend):
- `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-table.tsx`, `restock-panel.tsx`, `restock-drawer.tsx` — revised.
- `frontend/apps/admin/src/components/commercial-intelligence/mix/mix-table.tsx`, `mix-drawer.tsx` — revised.
- `frontend/apps/admin/src/app/(app)/commercial-intelligence/page.tsx` — new data-fetch wave.
- `frontend/apps/admin/src/app/(app)/products/page.tsx` — new edit action for packaging fields.
- Corresponding `.spec.tsx` files — extend.

**Docs:**
- `frontend/apps/admin/CLAUDE.md` — update `/commercial-intelligence` and `/products`/`/inventory` sections.

---

## Task 1: `inventory-service` — parametrização fields on `MinimumLevel`

**Files:**
- Modify: `backend/apps/inventory-service/prisma/schema.prisma`
- Create: `backend/apps/inventory-service/prisma/migrations/<ts>_minimum_level_par_and_current_quantity/migration.sql`
- Modify: `backend/apps/inventory-service/src/modules/inventory/controllers/inventory.controller.ts`
- Modify: `backend/apps/inventory-service/src/modules/inventory/services/inventory.service.ts`
- Modify: `backend/apps/inventory-service/test/inventory.integration-spec.ts`

**Interfaces:**
- Consumes: nothing from other tasks in this plan.
- Produces (for Task 3's gateway proxy and Task 4's frontend hooks):
  - `PUT /inventory/:storeId/:sku/par-level` — body `{ parLevel: number }` (`SetParLevelDto`), response is the raw `MinimumLevel` row.
  - `PUT /inventory/:storeId/parametrizacao/bulk` — body `{ items: BulkParametrizacaoItemDto[] }` where `BulkParametrizacaoItemDto = { sku: string; minimum: number; parLevel?: number; currentQuantity?: number; currentQuantityAsOf?: string }`, response `{ updated: number }`.
  - `GET /inventory/:storeId/minimums` — response widened to `{ store_id: number; sku: string; minimum: number | null; par_level: number | null; current_quantity: number | null; current_quantity_as_of: string | null }[]`.
  - `StockView.minimum` type changes from `number | undefined` to `number | null | undefined` (existing route, widened field).

- [ ] **Step 1: Write the failing schema/migration expectation as an integration test**

Read `backend/apps/inventory-service/test/inventory.integration-spec.ts` in full first — find the existing `setMinimum`-related tests (per the research, at least lines 82, 248, 275-276 reference `setMinimum`) and copy their exact setup pattern (test DB connection, cleanup between tests, how a store/sku pair is seeded). Then add:

```typescript
describe('parametrização (par level, current quantity, bulk)', () => {
  it('setParLevel creates a MinimumLevel row when none exists yet, with minimum left null', async () => {
    const result = await service.setParLevel(501, 'SKU-PAR-1', 30);
    expect(result.store_id).toBe(501);
    expect(result.sku).toBe('SKU-PAR-1');
    expect(result.par_level).toBe(30);
    expect(result.minimum).toBeNull();
  });

  it('setParLevel updates only par_level on an existing row, leaving minimum untouched', async () => {
    await service.setMinimum(502, 'SKU-PAR-2', 5);
    const result = await service.setParLevel(502, 'SKU-PAR-2', 40);
    expect(result.minimum).toBe(5);
    expect(result.par_level).toBe(40);
  });

  it('bulkSetParametrizacao upserts multiple SKUs for a store in one call', async () => {
    const { updated } = await service.bulkSetParametrizacao(503, [
      { sku: 'SKU-BULK-1', minimum: 3, parLevel: 12, currentQuantity: 7, currentQuantityAsOf: '2026-09-24T00:00:00.000Z' },
      { sku: 'SKU-BULK-2', minimum: 6 },
    ]);
    expect(updated).toBe(2);
    const row1 = await prisma.minimumLevel.findUnique({ where: { store_id_sku: { store_id: 503, sku: 'SKU-BULK-1' } } });
    expect(row1?.minimum).toBe(3);
    expect(row1?.par_level).toBe(12);
    expect(row1?.current_quantity).toBe(7);
    expect(row1?.current_quantity_as_of?.toISOString()).toBe('2026-09-24T00:00:00.000Z');
    const row2 = await prisma.minimumLevel.findUnique({ where: { store_id_sku: { store_id: 503, sku: 'SKU-BULK-2' } } });
    expect(row2?.minimum).toBe(6);
    expect(row2?.par_level).toBeNull();
  });

  it('bulkSetParametrizacao re-run for the same store×sku overwrites cleanly, no duplicate rows', async () => {
    await service.bulkSetParametrizacao(504, [{ sku: 'SKU-BULK-3', minimum: 1, parLevel: 10 }]);
    await service.bulkSetParametrizacao(504, [{ sku: 'SKU-BULK-3', minimum: 2, parLevel: 20 }]);
    const rows = await prisma.minimumLevel.findMany({ where: { store_id: 504, sku: 'SKU-BULK-3' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].minimum).toBe(2);
    expect(rows[0].par_level).toBe(20);
  });

  it('listMinimums returns par_level and current_quantity alongside minimum', async () => {
    await service.bulkSetParametrizacao(505, [{ sku: 'SKU-LIST-1', minimum: 4, parLevel: 15, currentQuantity: 9, currentQuantityAsOf: '2026-09-20T00:00:00.000Z' }]);
    const rows = await service.listMinimums(505);
    expect(rows[0]).toMatchObject({ store_id: 505, sku: 'SKU-LIST-1', minimum: 4, par_level: 15, current_quantity: 9 });
    expect(rows[0].current_quantity_as_of?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('below_minimum stays undefined when a MinimumLevel row exists but minimum itself is null', async () => {
    await service.setParLevel(506, 'SKU-NULLMIN', 25); // creates a row with minimum: null, par_level: 25
    const view = await service.stockForSku(506, 'SKU-NULLMIN', '2026-09');
    expect(view.below_minimum).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend/apps/inventory-service && pnpm test:integration -- inventory.integration-spec.ts` (check `package.json`'s `scripts` for the exact integration-test command name — mirror whatever the existing `setMinimum` tests already use to run, since this file already has a working test harness).
Expected: FAIL — `setParLevel`, `bulkSetParametrizacao` are not defined on the service, `listMinimums`'s current shape doesn't have `par_level`/`current_quantity`.

- [ ] **Step 3: Extend the Prisma schema**

In `backend/apps/inventory-service/prisma/schema.prisma`, change the `MinimumLevel` model from:

```prisma
model MinimumLevel {
  id       Int    @id @default(autoincrement())
  store_id Int
  sku      String
  minimum  Int

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  @@unique([store_id, sku])
  @@map("minimum_level")
}
```

to:

```prisma
model MinimumLevel {
  id                      Int       @id @default(autoincrement())
  store_id                Int
  sku                     String
  minimum                 Int?
  par_level               Int?
  current_quantity        Int?
  current_quantity_as_of  DateTime?

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  @@unique([store_id, sku])
  @@map("minimum_level")
}
```

`minimum` becomes nullable — the table has zero rows in production today (confirmed by earlier audit: no seed, no writer besides the never-called endpoint, no data-loss risk), and making it nullable removes the ambiguity of defaulting to `0` (a real, valid minimum value) when a row is created by `setParLevel` for a SKU that has never had a minimum configured.

- [ ] **Step 4: Generate and apply the migration**

Run: `cd backend/apps/inventory-service && pnpm prisma migrate dev --name minimum_level_par_and_current_quantity`
Expected: creates `prisma/migrations/<timestamp>_minimum_level_par_and_current_quantity/migration.sql` with an `ALTER TABLE minimum_level` statement — read the generated SQL to confirm it does `ALTER COLUMN minimum DROP NOT NULL` plus 3 `ADD COLUMN` statements, nothing else (no data loss, no other table touched).

- [ ] **Step 5: Add the new DTOs**

In `backend/apps/inventory-service/src/modules/inventory/controllers/inventory.controller.ts`, alongside the existing `SetMinimumDto` (do not modify it), add:

```typescript
export class SetParLevelDto {
  @ApiProperty({ description: 'Quantidade-alvo (nível de par) configurada para este Produto × Loja.' })
  @IsInt()
  @Min(0)
  parLevel: number
}

export class BulkParametrizacaoItemDto {
  @ApiProperty()
  @IsString()
  sku: string

  @ApiProperty()
  @IsInt()
  @Min(0)
  minimum: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  parLevel?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  currentQuantity?: number

  @ApiProperty({ required: false, description: 'ISO 8601 — quando a leitura de quantidade atual foi observada.' })
  @IsOptional()
  @IsISO8601()
  currentQuantityAsOf?: string
}

export class BulkSetParametrizacaoDto {
  @ApiProperty({ type: [BulkParametrizacaoItemDto] })
  @ValidateNested({ each: true })
  @Type(() => BulkParametrizacaoItemDto)
  @ArrayMinSize(1)
  items: BulkParametrizacaoItemDto[]
}
```

Add the needed imports (`IsISO8601`, `ValidateNested`, `ArrayMinSize`, `Type` from `class-transformer`) — check the top of the file for what's already imported from `class-validator`/`class-transformer` and extend that import list rather than adding a second import statement for the same module.

- [ ] **Step 6: Add the new controller routes**

In the same file, alongside the existing `@Put(':storeId/:sku/minimum')` handler, add:

```typescript
@Put(':storeId/:sku/par-level')
setParLevel(
  @Param('storeId', ParseIntPipe) storeId: number,
  @Param('sku') sku: string,
  @Body() body: SetParLevelDto,
) {
  return this.inventory.setParLevel(storeId, sku, body.parLevel)
}

@Put(':storeId/parametrizacao/bulk')
bulkSetParametrizacao(
  @Param('storeId', ParseIntPipe) storeId: number,
  @Body() body: BulkSetParametrizacaoDto,
) {
  return this.inventory.bulkSetParametrizacao(storeId, body.items)
}
```

Place these two routes before the existing `:storeId/:sku` GET route (NestJS matches routes in registration order — `parametrizacao/bulk` must not be shadowed by a more generic `:sku` param route matching it first; verify by checking how the existing `below-minimum` and `minimums` routes are already ordered before `:sku` in this same file, and follow that same ordering).

- [ ] **Step 7: Add the new service methods and widen existing ones**

In `backend/apps/inventory-service/src/modules/inventory/services/inventory.service.ts`, add:

```typescript
async setParLevel(storeId: number, sku: string, parLevel: number) {
  return this.prisma.minimumLevel.upsert({
    where: { store_id_sku: { store_id: storeId, sku } },
    create: { store_id: storeId, sku, par_level: parLevel },
    update: { par_level: parLevel },
  })
}

async bulkSetParametrizacao(storeId: number, items: BulkParametrizacaoItemDto[]): Promise<{ updated: number }> {
  await this.prisma.$transaction(
    items.map((item) =>
      this.prisma.minimumLevel.upsert({
        where: { store_id_sku: { store_id: storeId, sku: item.sku } },
        create: {
          store_id: storeId,
          sku: item.sku,
          minimum: item.minimum,
          par_level: item.parLevel ?? null,
          current_quantity: item.currentQuantity ?? null,
          current_quantity_as_of: item.currentQuantityAsOf ? new Date(item.currentQuantityAsOf) : null,
        },
        update: {
          minimum: item.minimum,
          par_level: item.parLevel ?? null,
          current_quantity: item.currentQuantity ?? null,
          current_quantity_as_of: item.currentQuantityAsOf ? new Date(item.currentQuantityAsOf) : null,
        },
      }),
    ),
  )
  return { updated: items.length }
}
```

Widen `listMinimums` (currently `prisma.minimumLevel.findMany({ where: { store_id }, orderBy: { sku: 'asc' } })`) — no code change needed if it already does a plain `findMany` with no explicit `select` (it will naturally include the new columns), but **verify this by reading the method now** — if it has an explicit `select: { sku: true, minimum: true }` (or similar), widen that select list to include `par_level`, `current_quantity`, `current_quantity_as_of`.

Find `toView()` (or wherever `below_minimum` is computed from `minimum`) and change the null-check from `minimum === undefined ? undefined : closing <= minimum` to `minimum == null ? undefined : closing <= minimum` (using `==` deliberately, to treat both `null` and `undefined` the same way — Prisma returns `null` for an unset nullable column, not `undefined`).

Update the `StockView` interface's `minimum?: number` to `minimum?: number | null`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend/apps/inventory-service && pnpm test:integration -- inventory.integration-spec.ts`
Expected: PASS, all 6 new tests plus every pre-existing test in the file.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/inventory-service/
git commit -m "$(cat <<'EOF'
feat(inventory-service): add par level, current quantity and bulk upsert to MinimumLevel

Extends the existing, previously-empty MinimumLevel table (Produto x Loja)
with par_level (target/desired quantity) and current_quantity (an observed
snapshot, timestamped, never inferred) alongside the existing minimum
field. Adds a bulk upsert endpoint for populating many SKUs per store in
one call, needed for the one-time planograma import (later task in this
plan) without thousands of individual HTTP calls.

minimum becomes nullable: the table has zero rows in production, so this
is data-loss-free, and it removes the ambiguity of defaulting to 0 (a
real, valid minimum) when a row is created via the new par-level-only
write path.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `products-service` — packaging fields on `Product`

**Files:**
- Modify: `backend/apps/products-service/prisma/schema.prisma`
- Create: `backend/apps/products-service/prisma/migrations/<ts>_product_packaging_fields/migration.sql`
- Modify: the file containing `UpdateProductDto` (confirmed by Task 0's research at `product.dto.ts`)
- Modify: the file containing `ProductsService.update()` and `toView()` (confirmed at `products.service.ts`)
- Modify: the existing products-service test file that already covers `update()`/`toView()`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (for Task 3's gateway proxy and Task 4's frontend hooks):
  - `PATCH /products/:id` body widened to accept `unitsPerPackage?: number`, `packageType?: string`, `fractionable?: boolean` alongside the existing `name?`/`category?`.
  - `ProductView` widened to include `units_per_package: number | null`, `package_type: string | null`, `fractionable: boolean | null` in every response (`create`, `update`, `findById`, `list`).

- [ ] **Step 1: Read the current files in full**

Read `backend/apps/products-service/src/**/product.dto.ts`, `products.service.ts`, and `products.controller.ts` in full before writing anything — confirm the exact current `UpdateProductDto`, `ProductsService.update()`, and `toView()` match what's described above (the research already read these; re-confirm nothing has drifted since).

- [ ] **Step 2: Write the failing tests**

Find the existing test file covering `ProductsService.update()`/`toView()` (same directory pattern as the service file, `*.spec.ts` or `*.integration-spec.ts` — check both) and add, following its exact existing setup pattern:

```typescript
describe('packaging fields', () => {
  it('create accepts and returns packaging fields', async () => {
    const product = await service.create({
      sku: 'SKU-PKG-1', name: 'Produto embalado', category: 'snack',
      unitsPerPackage: 24, packageType: 'caixa', fractionable: true,
    });
    expect(product.units_per_package).toBe(24);
    expect(product.package_type).toBe('caixa');
    expect(product.fractionable).toBe(true);
  });

  it('create omits packaging fields as null when not provided', async () => {
    const product = await service.create({ sku: 'SKU-PKG-2', name: 'Produto sem embalagem', category: 'snack' });
    expect(product.units_per_package).toBeNull();
    expect(product.package_type).toBeNull();
    expect(product.fractionable).toBeNull();
  });

  it('update sets packaging fields on an existing product without touching name/category', async () => {
    const created = await service.create({ sku: 'SKU-PKG-3', name: 'Produto original', category: 'beverage' });
    const updated = await service.update(created.id, { unitsPerPackage: 12, packageType: 'fardo', fractionable: false });
    expect(updated.name).toBe('Produto original');
    expect(updated.category).toBe('beverage');
    expect(updated.units_per_package).toBe(12);
    expect(updated.package_type).toBe('fardo');
    expect(updated.fractionable).toBe(false);
  });

  it('list and findById also return packaging fields', async () => {
    const created = await service.create({ sku: 'SKU-PKG-4', name: 'Outro produto', category: 'meal', unitsPerPackage: 6, packageType: 'pacote', fractionable: true });
    const found = await service.findById(created.id);
    expect(found.units_per_package).toBe(6);
    const [listed] = (await service.list({ search: 'SKU-PKG-4' })).filter((p) => p.sku === 'SKU-PKG-4');
    expect(listed.package_type).toBe('pacote');
  });
});
```

(If `service.create`/`service.list` have a different signature than assumed here — e.g. `list()` takes no filter, or returns a wrapper object — adjust to match the file you just read in Step 1; the assertions and field names are what matter, not the exact call shape, which must match the real code.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend/apps/products-service && pnpm test -- <the test file>`
Expected: FAIL — `create`/`update` reject the extra fields (or silently drop them, depending on current DTO strictness) and `toView()` never returns them.

- [ ] **Step 4: Extend the Prisma schema**

In `backend/apps/products-service/prisma/schema.prisma`, add to the `Product` model (after `status`, before the relation fields):

```prisma
  units_per_package Int?
  package_type      String?
  fractionable      Boolean?
```

- [ ] **Step 5: Generate and apply the migration**

Run: `cd backend/apps/products-service && pnpm prisma migrate dev --name product_packaging_fields`
Expected: a migration with 3 `ADD COLUMN` statements on `product`, all nullable, no data loss for the 232 existing rows.

- [ ] **Step 6: Widen the DTOs**

In the DTO file, extend `UpdateProductDto` (currently only `name?`/`category?`) with:

```typescript
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerPackage?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  packageType?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  fractionable?: boolean
```

Check whether there's a separate `CreateProductDto` (the `service.create()` calls in Step 2's tests imply one exists) — if so, widen it the same way; if `create()` reuses `UpdateProductDto`'s shape or a shared base, widen whichever DTO actually governs `create()`'s accepted body.

- [ ] **Step 7: Widen the service**

In `ProductsService.update()`, the `changes` parameter type widens to include the 3 new optional fields — since the current implementation already does `prisma.product.update({ data: { ...changes, ... } })` (a spread), no logic change is needed beyond widening the TypeScript parameter type to match the DTO; the spread already forwards any object key that's a valid Prisma column. Confirm `create()` does the same spread-based forwarding; widen its parameter type identically if not already structurally compatible.

Widen `toView()`:

```typescript
function toView(product: {
  id: number; sku: string; name: string; category: string
  units_per_package: number | null; package_type: string | null; fractionable: boolean | null
}): ProductView {
  return {
    id: product.id, sku: product.sku, name: product.name, category: product.category,
    units_per_package: product.units_per_package, package_type: product.package_type, fractionable: product.fractionable,
  }
}
```

Widen the `ProductView` type/interface to add the 3 new fields (all `number | null` / `string | null` / `boolean | null`).

Do **not** widen `toView()` to also return the other pre-existing-but-never-returned fields (`subcategory`, `ean`, `supplier_id`, `net_weight`, `ncm`, `cest`, `shelf_life_days`, `status`) — that's a real, separate gap (the frontend `Product` type already declares them but the backend never sends them) but it's unrelated to this task's scope; leave it alone.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend/apps/products-service && pnpm test -- <the test file>`
Expected: PASS, all new tests plus every pre-existing test in the file.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/products-service/
git commit -m "$(cat <<'EOF'
feat(products-service): add packaging fields (units per package, type, fractionable)

Adds three nullable fields to Product for the restock engine's future
package-multiple rounding — units_per_package, package_type, fractionable.
All 232 existing products get null (unknown), populated gradually through
the new admin UI (later task in this plan) rather than backfilled.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `gateway-service` — proxy the new routes

**Files:**
- Modify: `backend/apps/gateway-service/src/modules/domains/controllers/inventory.controller.ts`
- Modify: `backend/apps/gateway-service/src/modules/domains/controllers/products.controller.ts`
- Modify: the existing gateway test file(s) covering these two controllers

**Interfaces:**
- Consumes: Task 1's `PUT /inventory/:storeId/:sku/par-level` and `PUT /inventory/:storeId/parametrizacao/bulk`; Task 2's widened `PATCH /products/:id`.
- Produces: the same 3 routes, now reachable through the gateway with permission enforcement, for Task 4's frontend hooks to call.

- [ ] **Step 1: Read the current files in full**

Read `backend/apps/gateway-service/src/modules/domains/controllers/inventory.controller.ts` and `products.controller.ts` in full (82 and 99 lines respectively per the earlier research) — confirm the exact `DomainClient`/`this.domains.inventory({...})` forwarding pattern and the `@RequiresPermission(PERMISSIONS.X)` decorator usage before writing new routes.

- [ ] **Step 2: Find the existing test files and write failing tests**

Find the gateway's existing test(s) for these two controllers (search for a `*.spec.ts` importing `InventoryController`/`ProductsController` from `domains/controllers`). Read 2-3 existing tests there in full to learn the exact mocking pattern for `DomainClient`/`this.domains.inventory`/`this.domains.products`. Then add, following that exact pattern:

```typescript
it('PUT /inventory/:storeId/:sku/par-level requires INVENTORY_WRITE and forwards to inventory-service', async () => {
  // mock domains.inventory to resolve, call the controller method (or via supertest against the app,
  // matching whichever style the existing setMinimum test already uses), assert:
  // - the call is rejected without INVENTORY_WRITE permission (403), matching the existing minimum-route test
  // - with INVENTORY_WRITE, domains.inventory is called with { method: 'put', path: '/:storeId/:sku/par-level', payload: { parLevel: 30 }, correlationId: expect.any(String) }
});

it('PUT /inventory/:storeId/parametrizacao/bulk requires INVENTORY_WRITE and forwards to inventory-service', async () => {
  // same pattern, payload: { items: [...] }
});

it('PATCH /products/:id requires PRODUCTS_WRITE and forwards to products-service', async () => {
  // same pattern, payload: { unitsPerPackage: 24, packageType: 'caixa', fractionable: true }
});
```

Write these as real, complete tests matching whatever assertion style the file you just read in Step 1/2 already uses — the pseudocode above names exactly what must be asserted; translate it into that file's real test syntax (do not leave it as pseudocode in the actual file).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend/apps/gateway-service && pnpm test -- <the test file(s)>`
Expected: FAIL — the 3 new routes don't exist yet (404/no handler).

- [ ] **Step 4: Add the gateway routes**

In `inventory.controller.ts`, alongside the existing `@Put(':storeId/:sku/minimum')` handler:

```typescript
@Put(':storeId/:sku/par-level')
@RequiresPermission(PERMISSIONS.INVENTORY_WRITE)
setParLevel(@Param('storeId') storeId: string, @Param('sku') sku: string, @Body() body: unknown, @Req() request: Request) {
  return this.domains.inventory({ method: 'put', path: `/${storeId}/${sku}/par-level`, payload: body, correlationId: correlationOf(request) })
}

@Put(':storeId/parametrizacao/bulk')
@RequiresPermission(PERMISSIONS.INVENTORY_WRITE)
bulkSetParametrizacao(@Param('storeId') storeId: string, @Body() body: unknown, @Req() request: Request) {
  return this.domains.inventory({ method: 'put', path: `/${storeId}/parametrizacao/bulk`, payload: body, correlationId: correlationOf(request) })
}
```

(Match the exact parameter decorators, `Request` typing, and `correlationOf(...)` call already used by the existing `setMinimum` handler you read in Step 1 — the snippet above shows the shape, but copy the real file's exact syntax rather than retyping from scratch.)

In `products.controller.ts`, alongside the existing `POST /products` handler:

```typescript
@Patch(':id')
@RequiresPermission(PERMISSIONS.PRODUCTS_WRITE)
update(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) {
  return this.domains.products({ method: 'patch', path: `/${id}`, payload: body, correlationId: correlationOf(request) })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend/apps/gateway-service && pnpm test -- <the test file(s)>`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/gateway-service/
git commit -m "$(cat <<'EOF'
feat(gateway): proxy par-level, bulk parametrização and product update routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend API layer — `lib/api/inventory.ts` and `lib/api/products.ts`

**Files:**
- Modify: `frontend/apps/admin/src/lib/api/inventory.ts`
- Modify: `frontend/apps/admin/src/lib/api/products.ts`
- Test: colocated `*.spec.ts` if these files already have one (check first); if not, no test file is required for RTK Query endpoint definitions alone (matches existing convention — verify by checking whether `inventory.ts`/`products.ts` currently have sibling spec files before deciding).

**Interfaces:**
- Consumes: Task 3's 3 gateway routes.
- Produces (for Tasks 6, 7, 10, 12, 13, 14):
  - `StockItem` widened with `par_level: number | null`, `current_quantity: number | null`, `current_quantity_as_of: string | null`.
  - `useSetParLevelMutation()` — `(storeId: number, sku: string, parLevel: number) => Promise<StockItem>`.
  - `useListMinimumsQuery({ storeId })` — returns `StockItem[]` for that store (thin wrapper over `GET /inventory/:storeId/minimums`).
  - `useGetNetworkMinimumsQuery({ stores: Store[] })` — fans out one `useListMinimumsQuery`-equivalent call per store and merges into a single `StockItem[]`, mirroring the existing fan-out pattern used by `useGetNetworkSalesByStoreMonthQuery` etc.
  - `Product` type widened with `units_per_package: number | null`, `package_type: string | null`, `fractionable: boolean | null` (already loosely typed as optional per the research — confirm exact current typing and tighten to match the real backend response from Task 2).
  - `useUpdateProductMutation()` — `(id: number, changes: { name?: string; category?: ProductCategory; unitsPerPackage?: number; packageType?: string; fractionable?: boolean }) => Promise<Product>`.

- [ ] **Step 1: Read both files in full**

Read `frontend/apps/admin/src/lib/api/inventory.ts` (191 lines per the research) and `frontend/apps/admin/src/lib/api/products.ts` (83 lines) in full, plus one existing fan-out hook (e.g. `useGetNetworkSalesByStoreMonthQuery` in `sales.ts`, or `useGetNetworkSupplyByStoreMonthQuery` in `supply.ts`) to copy its exact fan-out implementation pattern (`Promise.all`/`queryFn`, error handling via `fetchOr404`/`firstError` from `src/lib/api/fan-out.ts`).

- [ ] **Step 2: Widen `StockItem` and add the inventory hooks**

In `inventory.ts`, widen the `StockItem` interface:

```typescript
export interface StockItem {
  store_id: number
  sku: string
  period: string
  restocked: number
  sold: number
  removed: number
  adjustment: number
  closing_stock: number
  inconsistent: boolean
  recorded_closing_balance: number | null
  minimum?: number | null
  below_minimum?: boolean
  par_level?: number | null
  current_quantity?: number | null
  current_quantity_as_of?: string | null
}
```

Add to the `inventoryApi` endpoints (following the exact `builder.mutation`/`builder.query` pattern the existing `setMinimum` endpoint already uses, including its `invalidatesTags: ['Minimum']`):

```typescript
setParLevel: builder.mutation<StockItem, { storeId: number; sku: string; parLevel: number }>({
  query: ({ storeId, sku, parLevel }) => ({ url: `/inventory/${storeId}/${sku}/par-level`, method: 'PUT', body: { parLevel } }),
  invalidatesTags: ['Minimum'],
}),
listMinimums: builder.query<StockItem[], { storeId: number }>({
  query: ({ storeId }) => `/inventory/${storeId}/minimums`,
  providesTags: ['Minimum'],
}),
```

Then, using the exact fan-out pattern copied in Step 1, add a hook (not an RTK-generated one, a plain function-based hook mirroring the copied file's shape) that fans `listMinimums` out across every store and merges results — name it `useGetNetworkMinimumsQuery` and give it the same `{ data, isLoading, error, refetch }` shape the copied fan-out hook returns, so `page.tsx` (Task 13) can consume it identically to the other network-wide queries already on that page.

- [ ] **Step 3: Widen `Product` and add the update mutation**

In `products.ts`, confirm/tighten the `Product` interface's packaging fields to exactly:

```typescript
  units_per_package: number | null
  package_type: string | null
  fractionable: boolean | null
```

(replacing whatever loose/absent typing is currently there for these three, per Task 2's real backend shape — the other pre-existing optional fields like `subcategory`/`ean` are untouched).

Add, following the exact pattern of the existing `recordPrice` mutation:

```typescript
updateProduct: builder.mutation<Product, { id: number; changes: { name?: string; category?: ProductCategory; unitsPerPackage?: number; packageType?: string; fractionable?: boolean } }>({
  query: ({ id, changes }) => ({ url: `/products/${id}`, method: 'PATCH', body: changes }),
  invalidatesTags: ['Product'],
}),
```

- [ ] **Step 4: Verify types compile**

Run: `cd frontend/apps/admin && pnpm exec tsc --noEmit`
Expected: clean (this task adds types/hooks, no consumers yet — later tasks wire them in).

- [ ] **Step 5: Commit**

```bash
git add frontend/apps/admin/src/lib/api/inventory.ts frontend/apps/admin/src/lib/api/products.ts
git commit -m "$(cat <<'EOF'
feat(admin): add par-level/bulk-parametrização/product-update API hooks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Engine types — `StoreSkuParametrizacao` and widened recommendation types

**Files:**
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/types.ts`
- Test: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/types.smoke.spec.ts` if one exists (check first — the loss-intelligence equivalent has one per earlier session notes); if not, this task's correctness is verified entirely by Tasks 6/7's tests consuming these types, so no dedicated test file is required here.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (for Tasks 6, 7, 8, 10, 11, 12): the `StoreSkuParametrizacao` type and the widened `RestockRecommendation`/`MixRecommendation` fields below.

- [ ] **Step 1: Read the current file in full**

Read `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/types.ts` in full (100 lines per the research) to confirm the exact current shape before editing.

- [ ] **Step 2: Add the new type and widen the two recommendation interfaces**

Add, near `LossSignal`:

```typescript
export interface StoreSkuParametrizacao {
  minimo: number | null
  nivelDePar: number | null
  quantidadeAtual: number | null
  quantidadeAtualEm: string | null
}
```

Widen `RestockRecommendation` by adding these fields (alongside the existing ones, none removed or renamed):

```typescript
  parametrizacao: StoreSkuParametrizacao | null
  deltaVsParametrizado: number | null
  aproveitamento: number | null
```

Widen `MixRecommendation` by adding:

```typescript
  historicoMensal: StoreSkuMonth[]
  parametrizacao: StoreSkuParametrizacao | null
```

(`MixRecommendation` does NOT get `deltaVsParametrizado` — Mix produces a classification, not a quantity, so a delta-vs-parametrizado doesn't apply there; only the parametrização fact itself is shown, per the approved design doc §4.)

- [ ] **Step 3: Verify types compile**

Run: `cd frontend/apps/admin && pnpm exec tsc --noEmit`
Expected: **FAILS** at this point — every existing construction of a `RestockRecommendation`/`MixRecommendation` object (in `restock/engine.ts`, `mix/engine.ts`, and every test fixture across both engines' `.spec.ts` files) is now missing the new required fields. This is expected and intentional — Tasks 6 and 7 fix the production code; this task's job is only to define the types. Confirm the compiler output lists exactly the object-literal sites that need the new fields (this list is your checklist for Tasks 6/7 — do not add default/optional markers to make these fields optional just to silence the error; they must be genuinely required so no call site can forget to compute them).

- [ ] **Step 4: Commit**

```bash
git add frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/types.ts
git commit -m "$(cat <<'EOF'
feat(admin): add StoreSkuParametrizacao and widen recommendation types

tsc is intentionally red after this commit — restock/engine.ts and
mix/engine.ts (next two tasks) populate the new required fields at every
existing construction site.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `restock/engine.ts` — parametrização, aproveitamento, rounding lean

**Files:**
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/engine.ts`
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/parameters.ts`
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/parameter-docs.ts`
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/env.ts`
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/parameter-rows.ts`
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/engine.spec.ts`
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/parameters.spec.ts`

**Interfaces:**
- Consumes: Task 5's `StoreSkuParametrizacao`, widened `RestockRecommendation`.
- Produces (for Task 8's table, Task 9's panel, Task 10's drawer, Task 13's page):
  - `RestockEngineInput` gains `parametrizacaoFor: (storeId: number, sku: string) => StoreSkuParametrizacao | null`.
  - Every `RestockRecommendation` now carries `parametrizacao`, `deltaVsParametrizado`, `aproveitamento`.
  - `RestockParameters` gains a `rounding` group: `{ shortShelfLifeDays: number; lowAproveitamentoThreshold: number; leanToMinFraction: number }`.

- [ ] **Step 1: Read the current engine file in full**

Read `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/engine.ts` (144 lines) in full — confirm the exact 4-tier precedence structure (hard-stop, reduce, evidence gate, normal formula) and the exact 4 `recommendations.push(...)` call sites described in the earlier research, since this task edits all 4.

- [ ] **Step 2: Read the parameters file and its siblings**

Read `restock/parameters.ts`, `parameter-docs.ts`, `env.ts`, `parameter-rows.ts` in full — confirm the exact existing group shape (e.g. `evidence`, `trend`, `action`, `lossIntegration`, `confidence`) and the exact `PARAMETER_DOCS`/`PARAMETER_KINDS`/`PARAMETER_PATHS`/`NEXT_PUBLIC_RESTOCK_*` pattern used for one existing group (e.g. `lossIntegration`, the smallest group) end-to-end, to replicate precisely for the new `rounding` group.

- [ ] **Step 3: Write the failing tests — parameters**

In `restock/parameters.spec.ts`, following the exact style of the existing tests for another group, add:

```typescript
describe('rounding parameters', () => {
  it('has documented defaults', () => {
    expect(DEFAULT_RESTOCK_PARAMETERS.rounding).toEqual({
      shortShelfLifeDays: 14,
      lowAproveitamentoThreshold: 0.6,
      leanToMinFraction: 0.25,
    });
  });
});
```

- [ ] **Step 4: Write the failing tests — engine**

In `restock/engine.spec.ts`, add (using the file's existing `baseInput`/`salesFor`/`supplyFor`/`lossResult`/`buildLossRecommendation` helpers — read them first to match exact call shapes):

```typescript
describe('parametrização', () => {
  it('attaches parametrizacao and deltaVsParametrizado when a par level is configured', () => {
    const result = computeRestockRecommendations(baseInput({
      parametrizacaoFor: (storeId, sku) => (storeId === 1 && sku === 'SKU-1' ? { minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: '2026-09-24T00:00:00.000Z' } : null),
    }));
    expect(result[0].parametrizacao).toEqual({ minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: '2026-09-24T00:00:00.000Z' });
    expect(result[0].deltaVsParametrizado).toBe(result[0].quantidadeSugeridaIA - 24);
  });

  it('parametrizacao and deltaVsParametrizado are null when nothing is configured for that store×sku', () => {
    const result = computeRestockRecommendations(baseInput({ parametrizacaoFor: () => null }));
    expect(result[0].parametrizacao).toBeNull();
    expect(result[0].deltaVsParametrizado).toBeNull();
  });

  it('attaches parametrizacao even on a hard-stop (suspender_abastecimento) row', () => {
    const result = computeRestockRecommendations(baseInput({
      lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: 'suspender_abastecimento' })]),
      parametrizacaoFor: () => ({ minimo: 0, nivelDePar: 20, quantidadeAtual: null, quantidadeAtualEm: null }),
    }));
    expect(result[0].acao).toBe('nao_abastecer');
    expect(result[0].parametrizacao?.nivelDePar).toBe(20);
    expect(result[0].deltaVsParametrizado).toBe(0 - 20); // quantidadeSugeridaIA is forced to 0 on hard-stop
  });

  it('attaches parametrizacao even when the evidence gate fires (dados_insuficientes)', () => {
    const result = computeRestockRecommendations(baseInput({
      salesByStoreMonth: salesFor([0, 0, 0, 0, 0, 10]),
      parametrizacaoFor: () => ({ minimo: 2, nivelDePar: 18, quantidadeAtual: 4, quantidadeAtualEm: '2026-09-01T00:00:00.000Z' }),
    }));
    expect(result[0].acao).toBe('dados_insuficientes');
    expect(result[0].parametrizacao?.nivelDePar).toBe(18);
  });
});

describe('aproveitamento', () => {
  it('computes vendido/abastecido over the analysed window', () => {
    const result = computeRestockRecommendations(baseInput({
      salesByStoreMonth: salesFor([10, 10, 10, 10, 10, 10]),
      supplyByStoreMonth: supplyFor([20, 20, 20, 20, 20, 20]),
    }));
    // 6 months x 10 sold = 60; 6 months x 20 restocked = 120; 60/120 = 0.5
    expect(result[0].aproveitamento).toBe(0.5);
  });

  it('is null when nothing was restocked in the window (never divides by zero)', () => {
    const result = computeRestockRecommendations(baseInput({ supplyByStoreMonth: supplyFor([null, null, null, null, null, null]) }));
    expect(result[0].aproveitamento).toBeNull();
  });
});

describe('rounding lean toward the lower end of the range', () => {
  it('leans toward faixaEstimada.min when the product has a short shelf life', () => {
    const shortShelfProduct = { ...PRODUCTS[0], shelf_life_days: 5 };
    const result = computeRestockRecommendations(baseInput({
      products: [shortShelfProduct],
      salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]),
      supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]),
    }));
    const leaned = Math.round(result[0].faixaEstimada.min + (result[0].faixaEstimada.max - result[0].faixaEstimada.min) * DEFAULT_RESTOCK_PARAMETERS.rounding.leanToMinFraction);
    expect(result[0].quantidadeSugeridaIA).toBeLessThanOrEqual(leaned);
  });

  it('does not lean when shelf_life_days is null (most products today)', () => {
    const noShelfLifeProduct = { ...PRODUCTS[0], shelf_life_days: null };
    const withNullShelfLife = computeRestockRecommendations(baseInput({
      products: [noShelfLifeProduct],
      salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]),
      supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]),
    }));
    const longShelfProduct = { ...PRODUCTS[0], shelf_life_days: 365 };
    const withLongShelfLife = computeRestockRecommendations(baseInput({
      products: [longShelfProduct],
      salesByStoreMonth: salesFor([10, 12, 14, 20, 24, 28]),
      supplyByStoreMonth: supplyFor([15, 15, 15, 15, 15, 15]),
    }));
    // null shelf life must behave like a long/healthy shelf life, not like a short one
    expect(withNullShelfLife[0].quantidadeSugeridaIA).toBe(withLongShelfLife[0].quantidadeSugeridaIA);
  });

  it('leans toward faixaEstimada.min when historical aproveitamento is low', () => {
    const result = computeRestockRecommendations(baseInput({
      salesByStoreMonth: salesFor([5, 6, 7, 20, 24, 28]), // low sales relative to supply most months
      supplyByStoreMonth: supplyFor([30, 30, 30, 30, 30, 30]), // aproveitamento well under 0.6
    }));
    expect(result[0].aproveitamento).toBeLessThan(DEFAULT_RESTOCK_PARAMETERS.rounding.lowAproveitamentoThreshold);
    const leaned = Math.round(result[0].faixaEstimada.min + (result[0].faixaEstimada.max - result[0].faixaEstimada.min) * DEFAULT_RESTOCK_PARAMETERS.rounding.leanToMinFraction);
    expect(result[0].quantidadeSugeridaIA).toBeLessThanOrEqual(leaned);
  });

  it('never leans on tier-1 (hard-stop) or tier-2 (reduce) rows — those already have a forced/scaled quantity', () => {
    const withoutLean = computeRestockRecommendations(baseInput({
      lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: 'reduzir_abastecimento' })]),
    }));
    const withShortShelfLife = computeRestockRecommendations(baseInput({
      products: [{ ...PRODUCTS[0], shelf_life_days: 1 }],
      lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: 'reduzir_abastecimento' })]),
    }));
    // the loss-integration scale factor is the only thing allowed to change the quantity on this tier
    expect(withShortShelfLife[0].quantidadeSugeridaIA).toBe(withoutLean[0].quantidadeSugeridaIA);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd frontend/apps/admin && pnpm exec jest restock-mix/restock/parameters.spec.ts restock-mix/restock/engine.spec.ts`
Expected: FAIL — `rounding` doesn't exist on `RestockParameters`, `parametrizacaoFor` isn't a valid `RestockEngineInput` field, `parametrizacao`/`deltaVsParametrizado`/`aproveitamento` are `undefined` on results.

- [ ] **Step 6: Add the `rounding` parameter group**

In `restock/parameters.ts`, add to the `RestockParameters` interface and `DEFAULT_RESTOCK_PARAMETERS`:

```typescript
  rounding: {
    shortShelfLifeDays: number
    lowAproveitamentoThreshold: number
    leanToMinFraction: number
  }
```

```typescript
  rounding: {
    shortShelfLifeDays: 14,
    lowAproveitamentoThreshold: 0.6,
    leanToMinFraction: 0.25,
  },
```

In `parameter-docs.ts`, `env.ts`, and `parameter-rows.ts`: replicate the EXACT pattern already used for the `lossIntegration` group (its `PARAMETER_DOCS` entries' shape — label/kind/unit/min/max/why/controls/up/down —, its `PARAMETER_KINDS` bucket assignment, its `PARAMETER_PATHS` union member additions, its `NEXT_PUBLIC_RESTOCK_LOSS_INTEGRATION_*` env var name pattern) for these 3 new `rounding.*` parameters. Classify all 3 as `business` kind (they encode risk tolerance — how conservative the engine is about waste risk — a company decision, not a statistical modeling detail) and give each a real `why`/`controls`/`up`/`down` description in Portuguese matching this codebase's existing tone (see any existing `business`-kind entry for the register/voice to match):
- `rounding.shortShelfLifeDays` — "Validade (em dias) abaixo da qual um produto é tratado como de risco de perda, puxando a sugestão para o piso da faixa estimada em vez do centro."
- `rounding.lowAproveitamentoThreshold` — "Proporção vendido/abastecido abaixo da qual o histórico do Produto×Loja é tratado como sinal de sobra recorrente, puxando a sugestão para o piso da faixa."
- `rounding.leanToMinFraction` — "Fração da faixa estimada (a partir do piso) usada como sugestão quando um sinal de risco (validade curta, baixo aproveitamento ou confiança baixa) está ativo — 0 seria sempre o piso exato, 1 seria sempre o teto."

- [ ] **Step 7: Widen `RestockEngineInput`**

In `restock/engine.ts`, add to `RestockEngineInput`:

```typescript
  parametrizacaoFor: (storeId: number, sku: string) => StoreSkuParametrizacao | null
```

(import `StoreSkuParametrizacao` from `../types`, alongside the other type imports already there).

- [ ] **Step 8: Compute `parametrizacao`, `deltaVsParametrizado`, `aproveitamento`, and apply the rounding lean**

Inside `computeRestockRecommendations`'s per-series loop, right after `const sinalPerdas = lossSignalFor(...)` (before the tier branches), add:

```typescript
const parametrizacao = input.parametrizacaoFor(series.storeId, series.sku);
const totalAbastecido = series.meses.reduce((sum, m) => sum + m.abastecido, 0);
const totalVendido = series.meses.reduce((sum, m) => sum + m.vendido, 0);
const aproveitamento = totalAbastecido > 0 ? totalVendido / totalAbastecido : null;

function deltaFor(quantidade: number): number | null {
  return parametrizacao?.nivelDePar != null ? quantidade - parametrizacao.nivelDePar : null;
}
```

Add `parametrizacao`, `deltaVsParametrizado: deltaFor(<that tier's quantidadeSugeridaIA>)`, and `aproveitamento` to every one of the 4 `recommendations.push({...})` call sites (tier 1 uses `deltaFor(0)`, tier 2 uses `deltaFor(<the scaled quantity>)`, the evidence-gate tier uses `deltaFor(0)`, the normal-formula tier uses `deltaFor(quantidadeSugeridaIA)` computed after the rounding lean below).

In the tier-3/4 (normal formula) branch only, after `quantidadeSugeridaIA = trend.estimativaCentral` and after `confianca` is computed, before `acao = determineAction(...)` is called, add the rounding lean:

```typescript
const shortShelfLife = product.shelf_life_days != null && product.shelf_life_days <= input.restockParameters.rounding.shortShelfLifeDays;
const lowAproveitamento = aproveitamento != null && aproveitamento < input.restockParameters.rounding.lowAproveitamentoThreshold;
const lowConfidence = confianca === 'baixa' || confianca === 'insuficiente';
if (shortShelfLife || lowAproveitamento || lowConfidence) {
  const leaned = Math.round(faixaEstimada.min + (faixaEstimada.max - faixaEstimada.min) * input.restockParameters.rounding.leanToMinFraction);
  quantidadeSugeridaIA = Math.min(quantidadeSugeridaIA, leaned);
}
```

(`quantidadeSugeridaIA` must already be declared with `let`, not `const`, for this reassignment — check the current declaration and change it if needed, same as the earlier `confianca` variable in this function which is already `let` for the same reason.)

Then call `acao = determineAction(quantidadeSugeridaIA, ultimoAbastecimento, ...)` using this final, leaned value (unchanged call site, just now operating on the adjusted number), and compute `deltaVsParametrizado: deltaFor(quantidadeSugeridaIA)` using the same final value for that tier's `recommendations.push(...)`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd frontend/apps/admin && pnpm exec jest restock-mix/restock/parameters.spec.ts restock-mix/restock/engine.spec.ts`
Expected: PASS, all new tests plus every pre-existing test in both files (the pre-existing tests' object literals for `RestockRecommendation` assertions don't need editing — they only check specific fields, not full-object equality, per the established pattern in this file; confirm this by checking none of them use `toEqual` against a full recommendation object without the new fields — if one does, that's a pre-existing test needing the 3 new fields added to its expected object, not a sign of a bug).

- [ ] **Step 10: Run the broader typecheck**

Run: `cd frontend/apps/admin && pnpm exec tsc --noEmit`
Expected: still red — `mix/engine.ts` (Task 7) hasn't been updated yet, `page.tsx` (Task 13) hasn't wired `parametrizacaoFor` yet. Confirm the remaining errors are ONLY in `mix/engine.ts`, `mix/engine.spec.ts`, and `page.tsx` — if `restock/engine.ts` or its own spec file still show errors, this task isn't done.

- [ ] **Step 11: Commit**

```bash
git add frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/restock/
git commit -m "$(cat <<'EOF'
feat(admin): thread parametrização into the restock engine, add rounding lean

quantidadeSugeridaIA now leans toward the lower end of the already-computed
faixaEstimada (never past it, never touching the range itself) when
shelf_life_days is short, historical aproveitamento is low, or confidence
is low — addresses "arredondamento não deve ser sempre pra cima" without
any package-multiple data (still unavailable). Loss Intelligence
precedence tiers 1/2 are untouched by the lean; parametrização/aproveitamento
are still attached to every tier for display.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `mix/engine.ts` — parametrização and `historicoMensal`

**Files:**
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/mix/engine.ts`
- Modify: `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/mix/engine.spec.ts`

**Interfaces:**
- Consumes: Task 5's `StoreSkuParametrizacao`, widened `MixRecommendation`.
- Produces (for Task 11's table, Task 12's drawer, Task 13's page): `MixEngineInput` gains `parametrizacaoFor: (storeId: number, sku: string) => StoreSkuParametrizacao | null`; every `MixRecommendation` now carries `historicoMensal`, `parametrizacao`.

- [ ] **Step 1: Read the current engine file in full**

Read `frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/mix/engine.ts` (197 lines) in full — confirm the exact `pushRecommendation()` helper (a single shared function all classification branches call through, per the earlier research) — this is simpler to extend than `restock/engine.ts`'s 4 separate push sites, since `mix/engine.ts` already centralizes recommendation construction in one place.

- [ ] **Step 2: Write the failing tests**

In `mix/engine.spec.ts`, using the file's existing `baseInput`/`salesFor`/`mergeSales`/`buildLossRecommendation` helpers:

```typescript
describe('parametrização', () => {
  it('attaches parametrizacao when configured for that store×sku', () => {
    const result = computeMixRecommendations(baseInput({
      parametrizacaoFor: (storeId, sku) => (storeId === 1 && sku === 'SKU-1' ? { minimo: 2, nivelDePar: 15, quantidadeAtual: 3, quantidadeAtualEm: '2026-09-24T00:00:00.000Z' } : null),
    }));
    expect(result[0].parametrizacao).toEqual({ minimo: 2, nivelDePar: 15, quantidadeAtual: 3, quantidadeAtualEm: '2026-09-24T00:00:00.000Z' });
  });

  it('parametrizacao is null when nothing is configured', () => {
    const result = computeMixRecommendations(baseInput({ parametrizacaoFor: () => null }));
    expect(result[0].parametrizacao).toBeNull();
  });

  it('attaches parametrizacao even on a suspender_abastecimento row', () => {
    const result = computeMixRecommendations(baseInput({
      lossResult: lossResult([buildLossRecommendation({ acaoPrioritaria: 'suspender_abastecimento' })]),
      parametrizacaoFor: () => ({ minimo: 1, nivelDePar: 10, quantidadeAtual: null, quantidadeAtualEm: null }),
    }));
    expect(result[0].classificacao).toBe('suspender_abastecimento');
    expect(result[0].parametrizacao?.nivelDePar).toBe(10);
  });
});

describe('historicoMensal', () => {
  it('attaches the same monthly series the engine computed internally', () => {
    const result = computeMixRecommendations(baseInput({ salesByStoreMonth: salesFor(1, 'SKU-1', [10, 10, 10, 10, 10, 10]) }));
    expect(result[0].historicoMensal).toHaveLength(6);
    expect(result[0].historicoMensal[5].vendido).toBe(10);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend/apps/admin && pnpm exec jest restock-mix/mix/engine.spec.ts`
Expected: FAIL — `parametrizacaoFor` isn't valid input, `historicoMensal`/`parametrizacao` are `undefined`.

- [ ] **Step 4: Widen `MixEngineInput` and `pushRecommendation`**

Add to `MixEngineInput`: `parametrizacaoFor: (storeId: number, sku: string) => StoreSkuParametrizacao | null` (import `StoreSkuParametrizacao` from `../types`).

Widen `pushRecommendation`'s `fields` parameter to accept `historicoMensal: StoreSkuMonth[]` and `parametrizacao: StoreSkuParametrizacao | null`, and forward both into the pushed object.

- [ ] **Step 5: Pass `historicoMensal`/`parametrizacao` at every `pushRecommendation(...)` call site**

At the top of the per-series loop in `computeMixRecommendations`, add:

```typescript
const parametrizacao = input.parametrizacaoFor(series.storeId, series.sku);
```

Add `historicoMensal: series.meses, parametrizacao` to every `pushRecommendation(recommendations, series, product, {...})` call's `fields` object (all of them route through the same helper per Step 1's finding — this should be a small, mechanical addition at each call site, not a rewrite of the branching logic itself).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend/apps/admin && pnpm exec jest restock-mix/mix/engine.spec.ts`
Expected: PASS, all new tests plus every pre-existing test.

- [ ] **Step 7: Run the broader typecheck**

Run: `cd frontend/apps/admin && pnpm exec tsc --noEmit`
Expected: still red only in `page.tsx` (Task 13 hasn't wired `parametrizacaoFor` into either engine input yet). Confirm no errors remain in either engine or either engine's spec file.

- [ ] **Step 8: Commit**

```bash
git add frontend/apps/admin/src/lib/commercial-intelligence/restock-mix/mix/
git commit -m "$(cat <<'EOF'
feat(admin): thread parametrização and historicoMensal into the mix engine

No classification logic changes — parametrização is attached as a fact
for display (per the operator's 2026-09-24 decision to keep it
reference-only for this revision), never used to decide manter/explorar/
reduzir.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `restock-table.tsx` — revised columns

**Files:**
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-table.tsx`
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-table.spec.tsx`

**Interfaces:**
- Consumes: Task 5/6's widened `RestockRecommendation` (`parametrizacao`, `deltaVsParametrizado`, `aproveitamento`, `historicoMensal`-backed `vendasUltimoMes` already present).
- Produces: no new exports beyond the existing `RestockDisplayRow`/`RestockTable` — this task only changes what's rendered inside the existing component's table body.

- [ ] **Step 1: Read the current file in full**

Read `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-table.tsx` (218 lines) in full — confirm the exact current 9-column header row, the `signalLabel`/`suggestedQuantityLabel`/`ACTION_LABELS`/`CONFIDENCE_TO_LEVEL` helpers already added by the previous fix round, and the `generated`/`overrides` state.

- [ ] **Step 2: Write the failing tests**

In `restock-table.spec.tsx`, extend the `rec()` fixture helper (read its current shape first) to accept `parametrizacao`/`deltaVsParametrizado`/`aproveitamento` overrides, and add:

```typescript
it('shows Parametrizado atual and Δ vs. parametrizado when configured', () => {
  const rows = [recRow('Produto Com Par', { parametrizacao: { minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: '2026-09-24T00:00:00.000Z' }, quantidadeSugeridaIA: 9, deltaVsParametrizado: -15 })];
  render(<RestockTable rows={rows} onSelect={jest.fn()} />);
  const row = screen.getByText('Produto Com Par').closest('tr');
  expect(within(row!).getByText('24')).toBeInTheDocument();
  expect(within(row!).getByText('9 ↓15')).toBeInTheDocument();
});

it('shows "—" for Parametrizado atual and Δ when nothing is configured', () => {
  const rows = [recRow('Produto Sem Par', { parametrizacao: null, deltaVsParametrizado: null })];
  render(<RestockTable rows={rows} onSelect={jest.fn()} />);
  const row = screen.getByText('Produto Sem Par').closest('tr');
  const cells = within(row!).getAllByRole('cell');
  expect(cells.some((c) => c.textContent === '—')).toBe(true);
});

it('shows Δ with an up arrow when the suggestion exceeds parametrizado, and "= manter" when equal', () => {
  const rows = [
    recRow('Sobe', { parametrizacao: { minimo: 1, nivelDePar: 12, quantidadeAtual: null, quantidadeAtualEm: null }, quantidadeSugeridaIA: 18, deltaVsParametrizado: 6 }),
    recRow('Mantem', { sku: 'SKU-MANTEM', parametrizacao: { minimo: 1, nivelDePar: 12, quantidadeAtual: null, quantidadeAtualEm: null }, quantidadeSugeridaIA: 12, deltaVsParametrizado: 0 }),
  ];
  render(<RestockTable rows={rows} onSelect={jest.fn()} />);
  expect(within(screen.getByText('Sobe').closest('tr')!).getByText('18 ↑6')).toBeInTheDocument();
  expect(within(screen.getByText('Mantem').closest('tr')!).getByText('12 = manter')).toBeInTheDocument();
});

it('shows Abastecido/Vendido/Perdido totals over the historical window, and Aproveitamento', () => {
  const rows = [recRow('Produto Com Historico', {
    historicoMensal: [
      { period: '2026-06', vendido: 10, abastecido: 20, perdido: 2, receitaCents: 5000 },
      { period: '2026-07', vendido: 15, abastecido: 20, perdido: 1, receitaCents: 7500 },
      { period: '2026-08', vendido: 12, abastecido: 20, perdido: 0, receitaCents: 6000 },
    ],
    aproveitamento: 0.617,
  })];
  render(<RestockTable rows={rows} onSelect={jest.fn()} />);
  const row = screen.getByText('Produto Com Historico').closest('tr');
  expect(within(row!).getByText('60')).toBeInTheDocument(); // 20+20+20 abastecido
  expect(within(row!).getByText('37')).toBeInTheDocument(); // 10+15+12 vendido
  expect(within(row!).getByText('3 un.')).toBeInTheDocument(); // 2+1+0 perdido, compact
  expect(within(row!).getByText('62%')).toBeInTheDocument(); // aproveitamento rounded to nearest %
});

it('shows "—" for Aproveitamento when null (nothing restocked in the window)', () => {
  const rows = [recRow('Sem Abastecimento', { aproveitamento: null })];
  render(<RestockTable rows={rows} onSelect={jest.fn()} />);
  const row = screen.getByText('Sem Abastecimento').closest('tr');
  expect(within(row!).getAllByText('—').length).toBeGreaterThan(0);
});
```

Add `within` to the file's existing `@testing-library/react` import if not already present (it was added by the previous fix round for a different test — confirm before re-adding).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend/apps/admin && pnpm exec jest restock-table.spec.tsx`
Expected: FAIL — none of the new columns/cells exist yet.

- [ ] **Step 4: Add the new columns**

Add these helper functions near the existing `suggestedQuantityLabel`:

```typescript
function deltaLabel(delta: number | null): string {
  if (delta === null) return '—';
  if (delta === 0) return '0 = manter';
  return delta > 0 ? `+${delta} ↑${delta}` : `${delta + Math.abs(delta) - Math.abs(delta)} ↓${Math.abs(delta)}`;
}
```

(Simplify: the operator's example format is `"9 ↓15"` — i.e. the SUGGESTED quantity itself, followed by the delta's magnitude and direction, not the raw delta number prefixed with a sign. Rewrite `deltaLabel` to take BOTH the suggestion and the delta:)

```typescript
function deltaLabel(quantidadeSugeridaIA: number, delta: number | null): string {
  if (delta === null) return '—';
  if (delta === 0) return `${quantidadeSugeridaIA} = manter`;
  return delta > 0 ? `${quantidadeSugeridaIA} ↑${delta}` : `${quantidadeSugeridaIA} ↓${Math.abs(delta)}`;
}

function windowTotals(meses: { abastecido: number; vendido: number; perdido: number }[]): { abastecido: number; vendido: number; perdido: number } {
  return meses.reduce((acc, m) => ({ abastecido: acc.abastecido + m.abastecido, vendido: acc.vendido + m.vendido, perdido: acc.perdido + m.perdido }), { abastecido: 0, vendido: 0, perdido: 0 });
}

function aproveitamentoLabel(aproveitamento: number | null): string {
  return aproveitamento === null ? '—' : `${Math.round(aproveitamento * 100)}%`;
}
```

Add table header cells (after "Categoria", before "Vendas recentes" — matching the design doc's column order `Produto | Categoria | Parametrizado atual | Abastecido | Vendido | Perdido (motivo) | Aproveitamento | Tendência | Sugestão IA | Δ vs. parametrizado | Quantidade final | Confiança`):

```tsx
<TableHead className="text-right">Parametrizado atual</TableHead>
<TableHead className="text-right">Abastecido</TableHead>
<TableHead className="text-right">Vendido</TableHead>
<TableHead>Perdido</TableHead>
<TableHead className="text-right">Aproveitamento</TableHead>
```

and, after the existing "Sugestão IA" cell, before "Quantidade final":

```tsx
<TableHead className="text-right">Δ vs. parametrizado</TableHead>
```

Rename the existing "Sinal" header to "Tendência" (it already shows the trend icon/label OR the loss-signal warning via `signalLabel()` — no behavior change, this is a label-only rename matching the design doc's framing of trend as supporting evidence, not a renamed headline). Remove the standalone "Último abastecimento" column — it's superseded by "Abastecido" (the windowed total) and "Parametrizado atual"; keep the `ultimoAbastecimento` value available for the drawer (Task 10) instead of the table.

In the row-rendering body, for recommendation rows (`!isOpportunity`), add the corresponding cells:

```tsx
<TableCell className="text-right tabular">{row.data.parametrizacao?.nivelDePar ?? '—'}</TableCell>
<TableCell className="text-right tabular">{isOpportunity ? '—' : windowTotals(row.data.historicoMensal).abastecido}</TableCell>
<TableCell className="text-right tabular">{isOpportunity ? '—' : windowTotals(row.data.historicoMensal).vendido}</TableCell>
<TableCell>{isOpportunity ? '—' : perdidoCompactLabel(row.data.historicoMensal, row.data.sinalPerdas)}</TableCell>
<TableCell className="text-right tabular">{isOpportunity ? '—' : aproveitamentoLabel(row.data.aproveitamento)}</TableCell>
```

and, replacing the bare `suggestedQuantityLabel(row)` cell for "Δ vs. parametrizado":

```tsx
<TableCell className="text-right tabular">{isOpportunity ? '—' : deltaLabel(row.data.quantidadeSugeridaIA, row.data.deltaVsParametrizado)}</TableCell>
```

Write `perdidoCompactLabel` as a new helper: it takes `historicoMensal: StoreSkuMonth[]` and `sinalPerdas: LossSignal | null`, sums `perdido` across the window, and renders `"4 un. · Validade"` when there's exactly one loss reason to cite (reuse whatever reason text is already available via `sinalPerdas`/the drawer's existing loss-display logic — if no single dominant reason is cheaply available at this table-row level without a new per-reason breakdown field, render `"N un."` alone with no reason suffix here, and put the full per-reason breakdown in the drawer instead per the design doc's own instruction that full detail belongs in the drawer, not the table). Keep this helper simple: `${total} un.` when `total > 0`, `"—"` when `total === 0`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend/apps/admin && pnpm exec jest restock-table.spec.tsx`
Expected: PASS, all new tests plus every pre-existing test in the file (the pre-existing "Gerar lista" and filter tests don't touch the new columns and should be unaffected — if any pre-existing test asserts an exact header cell count or exact column order via a snapshot, update it to match the new column set; this is expected, not a regression).

- [ ] **Step 6: Commit**

```bash
git add frontend/apps/admin/src/components/commercial-intelligence/restock/restock-table.tsx frontend/apps/admin/src/components/commercial-intelligence/restock/restock-table.spec.tsx
git commit -m "$(cat <<'EOF'
feat(admin): revise restock table — parametrização, windowed totals, aproveitamento

Adds Parametrizado atual, Abastecido, Vendido, Perdido (compact), Aproveitamento
and Δ vs. parametrizado columns. Renames Sinal to Tendência (label only,
same signalLabel() logic). Removes the standalone Último abastecimento
column (superseded by Abastecido + Parametrizado atual; still available
in the drawer).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `restock-panel.tsx` — explicit window label

**Files:**
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-panel.tsx`
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-panel.spec.tsx`

**Interfaces:**
- Consumes: nothing new from other tasks — this task adds a `windowLabel: string` prop, computed and passed in by Task 13's `page.tsx`.
- Produces: `RestockPanel` accepts and renders a new required `windowLabel: string` prop.

- [ ] **Step 1: Read the current file in full**

Read `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-panel.tsx` (42 lines) in full — confirm its current props (`rows: RestockDisplayRow[]`) and its 5-stat resumo layout.

- [ ] **Step 2: Write the failing test**

In `restock-panel.spec.tsx`:

```typescript
it('shows the explicit analysis window label above the resumo', () => {
  render(<RestockPanel rows={[]} windowLabel="Base da recomendação: últimos 3 meses fechados (jun–ago/2026)" />);
  expect(screen.getByText('Base da recomendação: últimos 3 meses fechados (jun–ago/2026)')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend/apps/admin && pnpm exec jest restock-panel.spec.tsx`
Expected: FAIL — `windowLabel` prop doesn't exist, TS error or the text isn't rendered.

- [ ] **Step 4: Add the prop and render it**

Widen the component's props type to add `windowLabel: string`, and render it as a `<p className="text-sm text-muted-foreground">{windowLabel}</p>` immediately above the existing 5-stat grid.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/apps/admin && pnpm exec jest restock-panel.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/apps/admin/src/components/commercial-intelligence/restock/restock-panel.tsx frontend/apps/admin/src/components/commercial-intelligence/restock/restock-panel.spec.tsx
git commit -m "$(cat <<'EOF'
feat(admin): show the explicit analysis window above the restock resumo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `restock-drawer.tsx` — parametrização, embalagem, necessidade/sugestão split

**Files:**
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-drawer.tsx`
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-drawer.spec.tsx`

**Interfaces:**
- Consumes: Task 4's `useSetParLevelMutation`, `useSetMinimumMutation` (already existed), Task 4's `useUpdateProductMutation`; Task 5/6's widened `RestockRecommendation`.
- Produces: no new exports — internal restructuring of `RecommendationBody`.

- [ ] **Step 1: Read the current file in full**

Read `frontend/apps/admin/src/components/commercial-intelligence/restock/restock-drawer.tsx` (153 lines) in full — confirm the exact current section order and the `ConfidenceBadge`/`CONFIDENCE_TO_LEVEL` pattern from the last fix round.

- [ ] **Step 2: Write the failing tests**

In `restock-drawer.spec.tsx`, using the file's existing row-fixture helper:

```typescript
it('shows Parametrização atual with minimo, nível de par and quantidade atual reference', () => {
  const row = recRow({ parametrizacao: { minimo: 3, nivelDePar: 24, quantidadeAtual: 5, quantidadeAtualEm: '2026-09-20T00:00:00.000Z' } });
  render(<RestockDrawer row={row} open onOpenChange={jest.fn()} />);
  expect(screen.getByText('Parametrização atual')).toBeInTheDocument();
  expect(screen.getByText(/Nível de par: 24/)).toBeInTheDocument();
  expect(screen.getByText(/Mínimo crítico: 3/)).toBeInTheDocument();
  expect(screen.getByText(/Quantidade atual \(referência, não usada na sugestão\): 5/)).toBeInTheDocument();
});

it('shows "não registrada" when parametrização is null', () => {
  const row = recRow({ parametrizacao: null });
  render(<RestockDrawer row={row} open onOpenChange={jest.fn()} />);
  expect(screen.getByText('Parametrização atual: não registrada')).toBeInTheDocument();
});

it('splits Necessidade estimada (the range) from Sugestão operacional (the point) as separate labels', () => {
  const row = recRow({ faixaEstimada: { min: 13, max: 16 }, quantidadeSugeridaIA: 18 });
  render(<RestockDrawer row={row} open onOpenChange={jest.fn()} />);
  expect(screen.getByText(/Necessidade estimada: 13–16 unidades/)).toBeInTheDocument();
  expect(screen.getByText(/Sugestão operacional: 18 unidades/)).toBeInTheDocument();
});
```

(Keep the existing "Quantidade" section's pre-existing tests intact if they already assert on this same text with different labels — this task RENAMES the section's internal labels from generic "Faixa estimada"/"Sugestão operacional" wording to the operator's exact "Necessidade estimada"/"Sugestão operacional" phrasing if they differ; read the current file first to see if any rewording is even needed, since the previous fix round may have already used similar wording — do not assume, verify against Step 1's read.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend/apps/admin && pnpm exec jest restock-drawer.spec.tsx`
Expected: FAIL — no "Parametrização atual" section exists yet.

- [ ] **Step 4: Add the Parametrização section**

Add a new section in `RecommendationBody`, positioned after "Ação recomendada"/"Por quê?" and before "Histórico" (matching the design doc §3.3's order):

```tsx
<div>
  <h3 className="text-sm font-medium">Parametrização atual</h3>
  {data.parametrizacao ? (
    <div className="text-sm text-muted-foreground">
      <p>Nível de par: {data.parametrizacao.nivelDePar ?? '—'}</p>
      <p>Mínimo crítico: {data.parametrizacao.minimo ?? '—'}</p>
      <p>
        Quantidade atual (referência, não usada na sugestão): {data.parametrizacao.quantidadeAtual ?? '—'}
        {data.parametrizacao.quantidadeAtualEm && ` — registrada em ${new Date(data.parametrizacao.quantidadeAtualEm).toLocaleDateString('pt-BR')}`}
      </p>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">Parametrização atual: não registrada</p>
  )}
</div>
```

Do not add inline editing of `nivelDePar`/`minimo` in the drawer for this task — that's real scope (opening a dialog, wiring `useSetParLevelMutation`/`useSetMinimumMutation`, handling optimistic update/error) that deserves its own focused task; note it as explicitly deferred in this task's commit message, matching the plan's own discipline of not silently expanding a task's scope mid-implementation. (If the operator wants inline editing added, that's a natural, cheap follow-up once this read-only display ships and is verified — flag this in the final Self-Review's "declined to judge" style, not silently build it now.)

- [ ] **Step 5: Rename the Necessidade/Sugestão labels if needed**

Read the current "Quantidade" section's exact JSX. If it already renders `"Faixa estimada: X–Y unidades"` / `"Sugestão operacional: N unidades"` (per the original plan's Task 7 spec), rename only the first label from "Faixa estimada" to "Necessidade estimada" (matching the operator's exact phrasing) — leave "Sugestão operacional" as-is, it already matches.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend/apps/admin && pnpm exec jest restock-drawer.spec.tsx`
Expected: PASS, all new tests plus every pre-existing test.

- [ ] **Step 7: Commit**

```bash
git add frontend/apps/admin/src/components/commercial-intelligence/restock/restock-drawer.tsx frontend/apps/admin/src/components/commercial-intelligence/restock/restock-drawer.spec.tsx
git commit -m "$(cat <<'EOF'
feat(admin): show parametrização atual in the restock drawer (read-only)

Nível de par, mínimo crítico shown as facts; quantidade atual shown as a
timestamped reference, explicitly labeled as not used in the suggestion.
Inline editing is deliberately deferred to a follow-up — this task is
display-only.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `mix-table.tsx` — revised columns

**Files:**
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/mix/mix-table.tsx`
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/mix/mix-table.spec.tsx`

**Interfaces:**
- Consumes: Task 5/7's widened `MixRecommendation` (`historicoMensal`, `parametrizacao`, existing `margemPct`/`affinity`).
- Produces: no new exports — internal restructuring of the table body.

- [ ] **Step 1: Read the current file in full**

Read `frontend/apps/admin/src/components/commercial-intelligence/mix/mix-table.tsx` (129 lines) in full — confirm the exact current 6-column layout (Produto/Categoria/Situação/Evidência/Recomendação/Confiança, where "Situação" currently shows `TREND_LABEL[row.data.tendencia]`).

- [ ] **Step 2: Write the failing tests**

```typescript
it('shows Parametrizado, Abastecido, Vendido, Perdido and Margem columns from historicoMensal', () => {
  const row = mixRow({
    historicoMensal: [
      { period: '2026-06', vendido: 8, abastecido: 10, perdido: 1, receitaCents: 4000 },
      { period: '2026-07', vendido: 9, abastecido: 10, perdido: 0, receitaCents: 4500 },
    ],
    parametrizacao: { minimo: 2, nivelDePar: 12, quantidadeAtual: null, quantidadeAtualEm: null },
    margemPct: 0.35,
  });
  render(<MixTable rows={[row]} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
  const tr = screen.getByText(row.productLabel).closest('tr');
  expect(within(tr!).getByText('12')).toBeInTheDocument(); // parametrizado
  expect(within(tr!).getByText('20')).toBeInTheDocument(); // abastecido total
  expect(within(tr!).getByText('17')).toBeInTheDocument(); // vendido total
  expect(within(tr!).getByText('1 un.')).toBeInTheDocument(); // perdido total
  expect(within(tr!).getByText('35%')).toBeInTheDocument(); // margem
});

it('shows "—" for margem when null (no cost resolved)', () => {
  const row = mixRow({ margemPct: null });
  render(<MixTable rows={[row]} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
  const tr = screen.getByText(row.productLabel).closest('tr');
  expect(within(tr!).getAllByText('—').length).toBeGreaterThan(0);
});

it('shows Desempenho na rede as a labeled affinity ratio, not a bare number', () => {
  const row = mixRow({ affinity: 0.22 });
  render(<MixTable rows={[row]} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
  const tr = screen.getByText(row.productLabel).closest('tr');
  expect(within(tr!).getByText('0.22x a média da rede')).toBeInTheDocument();
});

it('shows "sem comparação" for Desempenho na rede when affinity is null', () => {
  const row = mixRow({ affinity: null });
  render(<MixTable rows={[row]} opportunities={[]} onSelect={jest.fn()} onSelectOpportunity={jest.fn()} />);
  const tr = screen.getByText(row.productLabel).closest('tr');
  expect(within(tr!).getByText('sem comparação')).toBeInTheDocument();
});
```

(Check the existing `mixRow()`/similar fixture helper's exact name and shape in the current spec file before using it — adapt if the real helper is named differently.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend/apps/admin && pnpm exec jest mix-table.spec.tsx`
Expected: FAIL.

- [ ] **Step 4: Add the new columns**

Reuse the `windowTotals`/`aproveitamentoLabel`-style helpers' pattern from Task 8 (do not import from `restock-table.tsx` — duplicate the small `windowTotals` helper locally in this file, matching the established convention in this codebase of small pure helpers living beside their one consumer rather than being pulled into a shared util for a 4-line function).

Add header cells: `Parametrizado`, `Abastecido`, `Vendido`, `Perdido`, `Margem` (after "Categoria", before the existing "Situação" — which keeps showing `TREND_LABEL[row.data.tendencia]`, per the design doc's explicit instruction that trend stays as supporting evidence, not removed, just no longer the headline metric it once was framed as). Rename the header "Situação" to "Tendência" to match its actual content (label-only change).

Add a "Desempenho na rede" column (after "Recomendação", before "Confiança") rendering:

```tsx
<TableCell>{row.data.affinity === null ? 'sem comparação' : `${row.data.affinity.toFixed(2)}x a média da rede`}</TableCell>
```

Add the corresponding body cells for Parametrizado/Abastecido/Vendido/Perdido/Margem, following the exact same "—" fallback pattern as Task 8's restock table (null/missing → "—", never a fabricated 0).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend/apps/admin && pnpm exec jest mix-table.spec.tsx`
Expected: PASS, all new tests plus every pre-existing test (update any pre-existing header-count/snapshot assertion to match the new column set, same as Task 8).

- [ ] **Step 6: Commit**

```bash
git add frontend/apps/admin/src/components/commercial-intelligence/mix/mix-table.tsx frontend/apps/admin/src/components/commercial-intelligence/mix/mix-table.spec.tsx
git commit -m "$(cat <<'EOF'
feat(admin): revise mix table — parametrização, windowed totals, margem, labeled affinity

Trend stays visible (renamed Situação -> Tendência) but is no longer the
only signal in the row — Parametrizado/Abastecido/Vendido/Perdido/Margem
now sit beside it, and affinity gets an explicit "Nx a média da rede"
label instead of a bare number.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `mix-drawer.tsx` — parametrização section

**Files:**
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/mix/mix-drawer.tsx`
- Modify: `frontend/apps/admin/src/components/commercial-intelligence/mix/mix-drawer.spec.tsx`

**Interfaces:**
- Consumes: Task 5/7's widened `MixRecommendation`.
- Produces: no new exports.

- [ ] **Step 1: Read the current file in full**

Read `frontend/apps/admin/src/components/commercial-intelligence/mix/mix-drawer.tsx` (113 lines) in full.

- [ ] **Step 2: Write the failing tests**

Mirror Task 10's Step 2 exactly, adapted to `MixDrawer`'s row-fixture helper:

```typescript
it('shows Parametrização atual with minimo and nível de par', () => {
  const row = mixDrawerRow({ parametrizacao: { minimo: 2, nivelDePar: 15, quantidadeAtual: 4, quantidadeAtualEm: '2026-09-24T00:00:00.000Z' } });
  render(<MixDrawer row={row} open onOpenChange={jest.fn()} />);
  expect(screen.getByText('Parametrização atual')).toBeInTheDocument();
  expect(screen.getByText(/Nível de par: 15/)).toBeInTheDocument();
});

it('shows "não registrada" when parametrização is null', () => {
  const row = mixDrawerRow({ parametrizacao: null });
  render(<MixDrawer row={row} open onOpenChange={jest.fn()} />);
  expect(screen.getByText('Parametrização atual: não registrada')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend/apps/admin && pnpm exec jest mix-drawer.spec.tsx`
Expected: FAIL.

- [ ] **Step 4: Add the section**

Add the identical section markup from Task 10 Step 4 (same JSX, same "não registrada" fallback) to `RecommendationBody`, positioned after "Situação" and before "Indicadores".

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend/apps/admin && pnpm exec jest mix-drawer.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/apps/admin/src/components/commercial-intelligence/mix/mix-drawer.tsx frontend/apps/admin/src/components/commercial-intelligence/mix/mix-drawer.spec.tsx
git commit -m "$(cat <<'EOF'
feat(admin): show parametrização atual in the mix drawer (read-only)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `page.tsx` — wire parametrização into both engines

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/commercial-intelligence/page.tsx`

**Interfaces:**
- Consumes: Task 4's `useGetNetworkMinimumsQuery`; Task 6/7's `parametrizacaoFor` engine input; Task 9's `RestockPanel`'s new `windowLabel` prop.
- Produces: nothing new for later tasks — this is the final wiring task for the engine/data-fetch side.

- [ ] **Step 1: Read the current file in full**

Read `frontend/apps/admin/src/app/(app)/commercial-intelligence/page.tsx` (242 lines per the research) in full — confirm the exact two-wave fetch structure and the `retryAll`/`combinedError`/`isLoading` composition from the earlier fix round.

- [ ] **Step 2: This task has no new automated test of its own**

`page.tsx`'s wiring is exercised end-to-end by Task 17's live verification (real browser, real data) rather than a unit test — this matches the file's existing convention (it has no dedicated `.spec.tsx`, per the original plan's Task 13). Proceed directly to implementation; verify correctness via `tsc`/manual reasoning about the data flow, then rely on Task 17 for behavioral confirmation.

- [ ] **Step 3: Add the minimums query**

Add, alongside the other network-wide queries already destructured near the top of the component:

```typescript
const { data: minimums, isLoading: loadingMinimums, error: minimumsError, refetch: refetchMinimums } = useGetNetworkMinimumsQuery({ stores: scopedStores }, { skip });
```

- [ ] **Step 4: Build the `parametrizacaoFor` lookup**

```typescript
const parametrizacaoBySkuStore = useMemo(() => {
  const map = new Map<string, StoreSkuParametrizacao>();
  for (const item of minimums ?? []) {
    map.set(`${item.store_id}:${item.sku}`, {
      minimo: item.minimum ?? null,
      nivelDePar: item.par_level ?? null,
      quantidadeAtual: item.current_quantity ?? null,
      quantidadeAtualEm: item.current_quantity_as_of ?? null,
    });
  }
  return map;
}, [minimums]);

const parametrizacaoFor = useCallback(
  (storeId: number, sku: string) => parametrizacaoBySkuStore.get(`${storeId}:${sku}`) ?? null,
  [parametrizacaoBySkuStore],
);
```

(Import `StoreSkuParametrizacao` from `@/lib/commercial-intelligence/restock-mix/types`.)

- [ ] **Step 5: Thread `parametrizacaoFor` into both engine inputs**

Add `parametrizacaoFor` to the `RestockEngineInput` object literal (inside the `restockRecommendations` `useMemo`) and to the `MixEngineInput` object literal (inside the `mixEngineInput` `useMemo`), and add `parametrizacaoFor` to both `useMemo`'s dependency arrays.

- [ ] **Step 6: Widen the loading/error/retry composition**

Add `loadingMinimums` to `isLoading`, `minimumsError` to `combinedError`, and `refetchMinimums()` to the `retryAll` callback (all three following the exact pattern already used for the other 5-6 queries on this page — this mirrors Task 1 of the fix round from the previous plan, applied to one more query source).

- [ ] **Step 7: Compute and pass the window label to `RestockPanel`**

```typescript
const windowLabel = useMemo(() => {
  const startLabel = new Date(`${engineRange.start}-01`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
  const endLabel = new Date(`${engineRange.end}-01`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
  return `Base da recomendação: últimos 3 meses fechados (${startLabel}–${endLabel})`;
}, [engineRange]);
```

Pass `windowLabel={windowLabel}` to the existing `<RestockPanel rows={restockDisplayRows} />` call.

(If `engineRange` isn't exactly 3 months per the current `RUNTIME_PARAMETERS.parameters.window` value, the label still correctly describes whatever range is actually in effect — do not hardcode "3 meses" in the string if `lookbackMonths` could differ; use the literal month count instead: `` `Base da recomendação: últimos ${lookbackMonths} meses fechados (${startLabel}–${endLabel})` ``, reusing the `lookbackMonths` variable already defined earlier in this file per the research's description of `engineRange`'s computation.)

- [ ] **Step 8: Run the typecheck**

Run: `cd frontend/apps/admin && pnpm exec tsc --noEmit`
Expected: **clean** — this is the task that resolves every remaining error introduced by Task 5's type widening.

- [ ] **Step 9: Run the full test suite**

Run: `cd frontend/apps/admin && pnpm exec jest`
Expected: PASS, every suite (this page has no dedicated spec file, but every other file's tests must still be green after this wiring change).

- [ ] **Step 10: Commit**

```bash
git add frontend/apps/admin/src/app/\(app\)/commercial-intelligence/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): wire parametrização data into both restock/mix engines

Fetches inventory-service's MinimumLevel network-wide (fan-out per store,
same pattern as sales/supply), builds a storeId:sku lookup, threads it
into both engines as parametrizacaoFor. Also adds the explicit analysis-
window label to the restock resumo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Products page — packaging fields edit UI

**Files:**
- Modify: `frontend/apps/admin/src/app/(app)/products/page.tsx`
- Test: `frontend/apps/admin/src/app/(app)/products/page.spec.tsx` (new — the page has no existing test file per the research; check once more before assuming, since this confirms a gap rather than an established absence you're introducing).

**Interfaces:**
- Consumes: Task 4's `useUpdateProductMutation`, widened `Product` type.
- Produces: nothing for later tasks — this is a leaf UI task.

- [ ] **Step 1: Read the current file and the `ResourceFormDialog` pattern in full**

Read `frontend/apps/admin/src/app/(app)/products/page.tsx` (194 lines) in full — confirmed read-only, no mutation call anywhere. Read `frontend/apps/admin/src/components/resource-form-dialog.tsx` in full (the admin CLAUDE.md names it "the CRUD form for every new domain") to learn its exact props contract (fields config, `toCents`/`fromCents` helpers, submit/mutation wiring) — find one existing consumer of it elsewhere in the app (e.g. a Fase C back-office screen mentioned in the CLAUDE.md, like suppliers or capex) and read that consumer in full as the pattern to replicate here.

- [ ] **Step 2: Write the failing test**

```typescript
it('opens an edit dialog for a product and saves packaging fields', async () => {
  server.use(/* mock GET /products to return one product with null packaging fields, matching this test file's existing MSW/mock setup if one exists — check Step 1's read for the real mocking convention */);
  render(<ProductsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /editar/i }));
  await userEvent.type(screen.getByLabelText(/unidades por embalagem/i), '24');
  await userEvent.selectOptions(screen.getByLabelText(/tipo de embalagem/i), 'caixa');
  await userEvent.click(screen.getByLabelText(/fracionável/i));
  await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
  // assert the mutation was called with { unitsPerPackage: 24, packageType: 'caixa', fractionable: true } —
  // exact assertion mechanism (mock function spy vs. MSW request capture) must match whatever
  // pattern the ResourceFormDialog consumer you read in Step 1 already uses for its own test.
});
```

(This pseudocode names the real behavior to assert; before finalizing, adapt every selector/mock call to match the real testing conventions found in Step 1 — do not invent a mocking layer this codebase doesn't already have.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend/apps/admin && pnpm exec jest products/page.spec.tsx`
Expected: FAIL — no "Editar" button exists yet.

- [ ] **Step 4: Add the edit action and dialog**

Add an "Editar" icon button (matching whatever icon/button pattern the Step 1 consumer uses, e.g. a pencil icon `Button variant="ghost" size="icon"`) to each row, opening a `ResourceFormDialog` configured with exactly 3 fields: `unitsPerPackage` (number input), `packageType` (a `<Select>` with options the operator is likely to actually use — `caixa`, `fardo`, `pacote`, `unidade` — plus allow free text if `ResourceFormDialog`'s field config supports a combobox/creatable pattern; if not, a plain text input is acceptable, matching whichever the Step 1 consumer's own analogous "closed-but-extensible" field already does), `fractionable` (checkbox). Wire the dialog's submit to `useUpdateProductMutation({ id: product.id, changes: { unitsPerPackage, packageType, fractionable } })`.

Do not add fields for `name`/`category`/any of the other pre-existing Product fields to this dialog — this task is scoped to packaging only, per the approved design doc; a general product-edit form is a separate, larger initiative not asked for here.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/apps/admin && pnpm exec jest products/page.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/apps/admin/src/app/\(app\)/products/
git commit -m "$(cat <<'EOF'
feat(admin): add packaging fields edit UI to the Products page

First edit capability on this previously read-only page — scoped
narrowly to the 3 new packaging fields, not a general product editor.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: One-time planograma import — parsing and store-matching logic

**Files:**
- Create: `backend/apps/ingestion-worker-service/src/modules/planogram-import/store-matcher.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/planogram-import/store-matcher.spec.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/planogram-import/parse-planograma-row.ts`
- Create: `backend/apps/ingestion-worker-service/src/modules/planogram-import/parse-planograma-row.spec.ts`
- Modify: `backend/apps/ingestion-worker-service/src/modules/ingestion/utils/row-mapping.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (for the manual real-file run documented after this task): `matchStoreForFilename(filename: string, stores: { id: number; name: string }[]): { storeId: number; storeName: string } | null` and `parsePlanogramaRow(row: unknown[], columnIndex: Record<string, number>): PlanogramaRow | null`, where `PlanogramaRow = { codigoProduto: string; minimoCritico: number | null; nivelDePar: number | null; quantidadeAtual: number | null }`.

- [ ] **Step 1: Write the failing store-matcher tests**

```typescript
import { matchStoreForFilename } from './store-matcher';

const STORES = [
  { id: 1, name: 'Ascenty - ADM' }, { id: 2, name: 'Ascenty - CPS01' }, { id: 3, name: 'Ascenty - HTL01' },
  { id: 4, name: 'Ascenty - HTL05' }, { id: 9, name: 'Ascenty - SP03' }, { id: 22, name: 'Ascenty - SP03 2' },
  { id: 10, name: 'Ascenty - SP03 Copa' }, { id: 16, name: 'Plena Saude - ADM Taipas' }, { id: 24, name: 'Plena Saude - ADM' },
];

describe('matchStoreForFilename', () => {
  it('matches the longest store name that appears as a substring of the normalized filename', () => {
    expect(matchStoreForFilename('Relatório_estoque Ascenty - SP03 - Osasco.xlsx', STORES)).toEqual({ storeId: 9, storeName: 'Ascenty - SP03' });
  });

  it('prefers the longer, more specific name when a shorter one is also a substring', () => {
    expect(matchStoreForFilename('Relatório_estoque  Plena Saude - ADM Taipas - Taipas.xlsx', STORES)).toEqual({ storeId: 16, storeName: 'Plena Saude - ADM Taipas' });
  });

  it('normalizes repeated internal whitespace before matching', () => {
    expect(matchStoreForFilename('Relatório_estoque   Ascenty - HTL01   - Hortolândia.xlsx', STORES)).toEqual({ storeId: 3, storeName: 'Ascenty - HTL01' });
  });

  it('returns null when no store name is found in the filename', () => {
    expect(matchStoreForFilename('Relatório_estoque HTL05 - Hortolândia.xlsx', STORES)).toBeNull();
  });

  it('returns null for a completely unrelated filename', () => {
    expect(matchStoreForFilename('planilha qualquer.xlsx', STORES)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- store-matcher.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `store-matcher.ts`**

```typescript
export interface StoreRef {
  id: number
  name: string
}

export interface StoreMatch {
  storeId: number
  storeName: string
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function matchStoreForFilename(filename: string, stores: StoreRef[]): StoreMatch | null {
  const body = normalize(filename.replace(/^Relatório_estoque/, '').replace(/\.xlsx$/i, ''))
  const matches = stores.filter((store) => body.includes(store.name))
  if (matches.length === 0) return null
  matches.sort((a, b) => b.name.length - a.name.length)
  return { storeId: matches[0].id, storeName: matches[0].name }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- store-matcher.spec.ts`
Expected: PASS.

- [ ] **Step 5: Extend `COLUMN_ALIASES` and write the failing row-parser tests**

In `row-mapping.ts`, add two new keys to `COLUMN_ALIASES` (alongside the existing restock/sales keys, same object, same style):

```typescript
  parLevel: ['Nível de par'],
  minimumCritical: ['Mínimo crítico'],
  currentQuantity: ['Quant. atual'],
  productCode: [...] // confirm this key doesn't already exist under a different name before adding — the earlier research found 'productCode' already mapped to ['Código Produto', 'Código', 'sku', 'Cód. produto'] for other sheet types; reuse that exact existing key rather than creating a duplicate, since 'Código Produto' is already one of its aliases.
```

(Only add `parLevel`, `minimumCritical`, `currentQuantity` as new keys — `productCode` already exists per the research; verify this by reading the current file before editing, and reuse it.)

Write, in `parse-planograma-row.spec.ts`:

```typescript
import { parsePlanogramaRow } from './parse-planograma-row';

const HEADER = ['Seleção', 'ID produto', 'Código Produto', 'Descrição Produto', 'Categoria produto', 'Preço', 'Código de barras', 'Capacidade mola', 'Mínimo crítico', 'Nível de par', 'Quant. atual', 'Tipo do Produto'];
const columnIndex = Object.fromEntries(HEADER.map((h, i) => [h, i]));

describe('parsePlanogramaRow', () => {
  it('extracts codigoProduto, minimoCritico, nivelDePar and quantidadeAtual from a real-shaped row', () => {
    const row = [1, 329, '1093', 'Agua tonica', 'Bebidas', 7.9, '7891991000840', 0, 3, 6, 5, 'Público'];
    expect(parsePlanogramaRow(row, columnIndex)).toEqual({ codigoProduto: '1093', minimoCritico: 3, nivelDePar: 6, quantidadeAtual: 5 });
  });

  it('treats a zero quantidade atual as a real, valid zero, not missing', () => {
    const row = [2, 367, '2258', 'Água', 'Bebidas', 5.5, '789', 0, 3, 6, 0, 'Público'];
    expect(parsePlanogramaRow(row, columnIndex)?.quantidadeAtual).toBe(0);
  });

  it('returns null fields for genuinely blank minimo/par/atual cells rather than coercing to 0', () => {
    const row = [3, 400, '9999', 'Produto sem par', 'Snacks', 4.0, '789', 0, null, null, null, 'Público'];
    expect(parsePlanogramaRow(row, columnIndex)).toEqual({ codigoProduto: '9999', minimoCritico: null, nivelDePar: null, quantidadeAtual: null });
  });

  it('returns null entirely when the row has no Código Produto', () => {
    const row = [4, 401, null, 'Linha inválida', 'Snacks', 4.0, '789', 0, 1, 2, 3, 'Público'];
    expect(parsePlanogramaRow(row, columnIndex)).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- parse-planograma-row.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement `parse-planograma-row.ts`**

```typescript
import { readRawColumn, toQuantity } from '../ingestion/utils/row-mapping'

export interface PlanogramaRow {
  codigoProduto: string
  minimoCritico: number | null
  nivelDePar: number | null
  quantidadeAtual: number | null
}

export function parsePlanogramaRow(row: unknown[], columnIndex: Record<string, number>): PlanogramaRow | null {
  const codigoProduto = readRawColumn(row, columnIndex, 'Código Produto')
  if (codigoProduto === null || codigoProduto === undefined || String(codigoProduto).trim() === '') return null

  return {
    codigoProduto: String(codigoProduto).trim(),
    minimoCritico: toQuantity(readRawColumn(row, columnIndex, 'Mínimo crítico')),
    nivelDePar: toQuantity(readRawColumn(row, columnIndex, 'Nível de par')),
    quantidadeAtual: toQuantity(readRawColumn(row, columnIndex, 'Quant. atual')),
  }
}
```

(Adjust the exact call signature of `readRawColumn`/`toQuantity` to match what Task 15's earlier research found — the research described `readRawColumn(row, key)` and `hasRawColumn(headers, key)` as the real signatures, not taking a raw `columnIndex` map; re-read `row-mapping.ts` now and use its REAL signatures rather than the illustrative ones above — the test file's `columnIndex` fixture may need to become a raw header array instead, matching whatever `readRawColumn` actually expects. Confirm `toQuantity(null)` and `toQuantity(undefined)` both return `null`, not `0` — if the real `toQuantity` coerces blank to `0` instead of `null`, wrap it: `const qty = readRawColumn(...); const value = qty === null || qty === undefined || qty === '' ? null : toQuantity(qty);` — write the failing test in Step 5 first against the REAL function signatures, not this illustrative sketch.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend/apps/ingestion-worker-service && pnpm test -- parse-planograma-row.spec.ts store-matcher.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/apps/ingestion-worker-service/src/modules/planogram-import/ backend/apps/ingestion-worker-service/src/modules/ingestion/utils/row-mapping.ts
git commit -m "$(cat <<'EOF'
feat(ingestion-worker): store-matching and row-parsing for the one-time planograma import

Pure, tested functions only — no Drive orchestration, no database writes.
The real one-time import run (documented in the plan, not part of this
automated task loop) composes these with the existing loadDriveConfig/
createGoogleDriveClient/readWorkbookRows utilities against the 20 real
files.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Documentation

**Files:**
- Modify: `frontend/apps/admin/CLAUDE.md`

**Interfaces:**
- Consumes: the finished state of Tasks 1-15.
- Produces: nothing for later tasks.

- [ ] **Step 1: Update the `/commercial-intelligence` section**

In `frontend/apps/admin/CLAUDE.md`'s `/commercial-intelligence` section (rewritten by the previous plan's final-review fix round), add a short subsection after "Motores puros" documenting: the `parametrizacaoFor` input (source: `inventory-service.MinimumLevel`, network-wide fan-out fetch, same pattern as sales/supply), that `quantidadeAtual` is reference-only and never feeds the formula (cite this explicitly, matching the file's existing style of calling out non-obvious constraints), and the rounding-lean parameters (`shortShelfLifeDays`/`lowAproveitamentoThreshold`/`leanToMinFraction`) with a one-line description of what they do.

- [ ] **Step 2: Add a short `/products` section note**

`frontend/apps/admin/CLAUDE.md` currently has no dedicated `/products` section (confirmed by Task 0's research — the page was read-only with no prior documentation need). Add a minimal new `## /products — Cadastro de produtos` section: one paragraph noting the page is otherwise read-only except for the new packaging-fields edit dialog (Task 14), and that `ProductView`/`toView()` in `products-service` still doesn't return most of `Product`'s other nullable fields (the pre-existing gap Task 2 deliberately left alone) — so a future editor for those fields needs backend work first, not just frontend.

- [ ] **Step 3: Commit**

```bash
git add frontend/apps/admin/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(admin): document parametrização wiring and the new /products edit capability

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Final verification

**Files:** none new — verification only.

- [ ] **Step 1: Typecheck every touched service**

Run, from the repo root:
```bash
pnpm --filter @agiliz/admin exec tsc --noEmit
cd backend/apps/inventory-service && pnpm exec tsc --noEmit && cd -
cd backend/apps/products-service && pnpm exec tsc --noEmit && cd -
cd backend/apps/gateway-service && pnpm exec tsc --noEmit && cd -
cd backend/apps/ingestion-worker-service && pnpm exec tsc --noEmit && cd -
```
Expected: clean on all 5.

- [ ] **Step 2: Lint every touched service**

Run the same 5 services' `pnpm exec eslint src` (or each service's real lint script — confirm the exact script name per service's `package.json`, they may differ from the frontend's).
Expected: 0 errors on all 5; any pre-existing warnings outside files this plan touched are left alone (same discipline as every prior verification pass this session).

- [ ] **Step 3: Test every touched service**

Run the same 5 services' full test suites.
Expected: all green, including the full pre-existing suite counts plus every test added by Tasks 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15.

- [ ] **Step 4: Production build the frontend**

Run: `pnpm --filter @agiliz/admin exec next build`
Expected: clean, all routes generated, including `/commercial-intelligence`, `/commercial-intelligence/calibration`, `/products`.

- [ ] **Step 5: Live verification against real data**

Same disposable-QA-user, LAN-IP pattern used for the original restock-mix plan's own Task 15 (stop `agiliz-admin-dev`, run a temporary `next dev` from the checkout serving this branch, disposable `operator`-role QA user via `docker exec agiliz-iam-dev`, delete the user afterward, restart the container). Confirm on a real store with real history:

- Abastecimento Inteligente: window label renders correctly above the resumo; Parametrizado atual/Abastecido/Vendido/Perdido/Aproveitamento/Δ vs. parametrizado columns show real numbers or "—", never a fabricated value; the drawer's Parametrização atual section shows "não registrada" for every row (expected — the real import from Task 18 below hasn't run yet at this point, so `MinimumLevel` is still empty in the real database).
- Mix das Lojas: same column set renders correctly, same "—" discipline.
- Products page: the new edit dialog opens, saves packaging fields, and they persist across a page reload.
- No new unexpected console errors beyond the already-documented 404s for un-ingested store/month combinations.

- [ ] **Step 6: Commit any fixes found during live verification**

Only if Step 5 surfaces something — otherwise nothing to commit here, matching the original plan's own Task 15 precedent.

---

## Task 18 (manual, not a fresh-subagent task): the real one-time planograma import

This step is deliberately **not** part of the automated subagent-driven-development loop — it writes real production data (parametrização for 20 real stores) and, per this plan's own Global Constraints, requires explicit human review of a dry run before any write. The controller (or the operator directly) runs this once, after Task 15 has landed and Task 17's verification is clean.

**The real file table** (Drive folder `agiliz.ai > planogramas`, audited 2026-09-24 — file IDs may need re-fetching if the folder changed since):

| Drive file ID | Filename | Resolved `store_id` | Store name |
|---|---|---|---|
| `1Y2ks-XfqCxN5tyn7804CBAJ0vrKVJIoU` | Relatório_estoque  Ascenty - SP05 - Osasco.xlsx | 12 | Ascenty - SP05 |
| `1-zL2jfXBzdu9Rn4BdeYplz-ZdmV7J8MH` | Relatório_estoque Ascenty - HTL01 - Hortolândia.xlsx | 3 | Ascenty - HTL01 |
| `1bjUxung47K36zB8Vf93ytDBAg-7OMspK` | Relatório_estoque  Ascenty - VIN01 - Vinhedo.xlsx | 14 | Ascenty - VIN01 |
| `1bSqQPwkfxOdKtMK3B9sOBLZslx47JgDQ` | Relatório_estoque Plena Saude - Itaqua - Itaqua.xlsx | 18 | Plena Saude - Itaqua |
| `11AUGRco8YQh-OpE3Ip-T0A16hQUGnIFp` | Relatório_estoque Plena Saude - Mogi  - Mogi das Cruzes.xlsx | 19 | Plena Saude - Mogi |
| `1cUFlg7Gxbdvbami--8fzx95elGCohb-q` | Relatório_estoque Ascenty - PLN01 - Paulinia.xlsx | 7 | Ascenty - PLN01 |
| `1jcO4GphJV3n6bb49MCF0Q9J2iDCtVPnW` | Relatório_estoque  Ascenty - CPS01 - Campinas.xlsx | 2 | Ascenty - CPS01 |
| `1tL7jWiBP0DPyJskbY5J3M_Dzs6Dv8nK8` | Relatório_estoque Ascenty - JDI02 - Jundiai.xlsx | 6 | Ascenty - JDI02 |
| `1E_NPm6CbTrJUxebM9SsRIDdAd9Prh5kt` | Relatório_estoque Rolls-Royce - Anhanguera.xlsx | 21 | Rolls-Royce |
| `1sHOfbrV9b30l_2tZB4QAlMcOMTeg_iP1` | Relatório_estoque Ascenty - SUM01.xlsx | 13 | Ascenty - SUM01 |
| `15bDG9St6z6V3jrMITS0J46vFJnBoNDGR` | Relatório_estoque Ascenty - SP04.xlsx | 11 | Ascenty - SP04 |
| `1v32Ht-0M7uCP9G5y4HIGnlZEFW0bM6bC` | Relatório_estoque Ascenty - SP03 - Osasco.xlsx | 9 | Ascenty - SP03 |
| `1Nyr4qBuUvst1-W5amCg2vo4Ny8vf24mJ` | Relatório_estoque  Ascenty - JDI01 - Jundiaí.xlsx | 5 | Ascenty - JDI01 |
| `14KE1BsGGcsGU8GnBFGs21UJvegOUuDms` | Relatório_estoque  Plena Saude - ADM Taipas - Taipas.xlsx | 16 | Plena Saude - ADM Taipas |
| `1P1IJFC9r1ptAjwWyXfFccBx7P6B0dhWc` | Relatório_estoque Plena Saude - Taipas - Hospital Taipas.xlsx | 20 | Plena Saude - Taipas |
| `1b9m0Sm_y4HdbgAXLLYM7yrhAUiGyBN4-` | Relatório_estoque  Ascenty - VIN02 .xlsx | 15 | Ascenty - VIN02 |
| `1n_FQEa_zo8r4teguOSS0r_rZoqz3_DYs` | Relatório_estoque  Ascenty - ADM - ADM - Vinhedo.xlsx | 1 | Ascenty - ADM |
| `1jI5Xsi_VH86-osUfS-h2r8tb71doaKCn` | Relatório_estoque HTL05 - Hortolândia.xlsx | 4 | Ascenty - HTL05 **(hardcoded exception — filename matcher returns null for this one, per the operator's own 2026-09-24 decision not to rename it)** |
| `1g38yaju3PNbrq-IIqbGQJnKl_yPNpLm9` | Relatório_estoque Ascenty - SP02 - Osasco.xlsx | 8 | Ascenty - SP02 |
| `1NLD9xi5UOgUh3EWP2vHAichJTpEK-k8P` | Relatório_estoque Plena Saude - Franco da Rocha - Franco da Rocha.xlsx | 17 | Plena Saude - Franco da Rocha |

**Steps:**

1. Write a small, throwaway script (not committed, matching this codebase's own established precedent for ad-hoc verification scripts against real files) that: authenticates via `loadDriveConfig(process.env)` + `createGoogleDriveClient(config)`; for each of the 20 file IDs above, downloads it and calls `readWorkbookRows(path)`; locates the header row and builds a `columnIndex`; calls `parsePlanogramaRow(row, columnIndex)` (Task 15) for every data row, skipping nulls; for the one hardcoded exception (`1jI5Xsi_VH86-osUfS-h2r8tb71doaKCn`), use `store_id: 4` directly instead of calling `matchStoreForFilename`.
2. **Dry run**: print, per store, the count of SKUs parsed and a sample of 5 rows (codigoProduto, minimoCritico, nivelDePar, quantidadeAtual) — do not write anything yet.
3. **Cross-check `codigoProduto` against the real `products-service` catalog** before writing: for any `codigoProduto` that doesn't match an existing `Product.sku`, exclude it from the write and list it separately in the dry-run output (a genuinely new/discontinued SKU in the planograma that Agiliz's catalog doesn't know about yet — surface it, never silently create a phantom product).
4. **Show the full dry-run output to the operator** and get explicit confirmation before proceeding — matching the "human confirms every import" principle used everywhere else in this codebase.
5. On confirmation, for each store, call `PUT /inventory/:storeId/parametrizacao/bulk` (Task 1/3) with the parsed items, using `currentQuantityAsOf` set to the report's actual `modifiedTime` from Drive (not the import run's own timestamp — the operator should see when the count was actually taken, not when it was imported).
6. Report the final per-store write counts and any excluded/unmatched SKUs back to the operator.

---

## Self-Review

**Spec coverage**: §1.1 (parametrização audit) → Tasks 1, 15, 18 (the real data path). §1.2 (embalagem audit) → Task 2. §1.3 (granularidade) → unchanged, no task needed (confirmed already correct). §2 (consequências no desenho) → every "sem dado = mostra '—', nunca trava" instance is a specific test in Tasks 6, 8, 10, 11, 12. §3.1 (tabela revisada) → Task 8. §3.2 (motor — necessidade vs. sugestão, arredondamento) → Task 6. §3.3 (drawer revisado) → Task 10. §4 (Mix revisado) → Tasks 7, 11, 12. §5 Decisão 1 (identificação de loja, confiabilidade do estoque, recorrência) → Task 15 (matcher) + Task 18 (the manual run, `quantidadeAtual` never touching the formula per Task 6's explicit test). §5 Decisão 2 (embalagem modelada agora) → Task 2 + Task 14. §6 (escopo de implementação) → Tasks 1, 2, 3 cover exactly the backend surface area that section named, including the `MinimumLevel`-reuse recommendation (not a new service) and the "confirm before assuming a route exists" flags the research resolved.

**Placeholder scan**: every step above has real code or a real, complete-enough-to-execute instruction (the few "read the file first, match its real pattern" steps — Task 3 Step 4, Task 14 Steps 1/2/4, Task 15 Step 7 — are a deliberate, established technique in this project's plans for adapting to code a subagent must read fresh, not a placeholder; each still names the exact behavior/assertions required, never leaves "add appropriate tests" unstated).

**Type consistency**: `StoreSkuParametrizacao` (Task 5) is used identically in `restock/engine.ts` (Task 6), `mix/engine.ts` (Task 7), `restock-drawer.tsx`/`mix-drawer.tsx` (Tasks 10/12), and `page.tsx` (Task 13) — same field names (`minimo`/`nivelDePar`/`quantidadeAtual`/`quantidadeAtualEm`) everywhere, never renamed mid-plan. `parametrizacaoFor(storeId, sku)` signature is identical across `RestockEngineInput`/`MixEngineInput`/`page.tsx`'s construction of it. `deltaVsParametrizado` exists only on `RestockRecommendation`, deliberately absent from `MixRecommendation` — confirmed consistent between Task 5's type definition and Tasks 8/11's table code (restock table renders it, mix table does not).

**Review Focus**: all 5 items from the header section have an owning task's test, confirmed above (dados_insuficientes + parametrização in Task 6; partial-data "—" discipline in Tasks 8/10/11/12; bulk re-import upsert-not-duplicate in Task 1; null shelf_life_days in Task 6; no-match filename case in Task 15).

---

## Execution Handoff

Plano completo, salvo em `docs/superpowers/plans/2026-09-24-restock-mix-operational-revision.md`. 17 tasks automatizáveis (Tasks 1-17) mais um passo manual final (Task 18, a importação real dos 20 arquivos — nunca parte do loop automático, exige revisão humana do dry-run antes de qualquer escrita).

Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **subagent-driven**, because it spans 4 backend services plus the frontend with real cross-task interface dependencies (Task 6/7 depend exactly on Task 5's types; Task 13 depends on Task 4's hook shape and Task 6/7's engine signatures) and a shipped mistake here would touch real production data (Task 18) — the same reasoning that led to subagent-driven for the original restock-mix plan, which this one extends. Does the plan capture what you want, and which approach should we use?
