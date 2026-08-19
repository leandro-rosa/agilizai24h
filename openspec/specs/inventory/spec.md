# inventory Specification

## Purpose
Stock levels in units per store and SKU, derived from the movements the platform already
records, together with the minimum levels that make a low-stock signal meaningful. It answers
"how much should be on this shelf" without anyone counting.

## Requirements

### Requirement: Stock derivation

The system SHALL derive stock in units per store and SKU from the movements the platform
records — restocks, sales, removals of any reason, and inventory adjustments — and SHALL
NOT accept a directly entered stock figure.

Every removal reduces stock whatever its reason: a returned unit leaves the shelf exactly
as an expired one does. An adjustment moves stock in or out depending on its sign.

#### Scenario: Deriving stock from movements

- **GIVEN** a store and SKU with 100 units restocked, 60 sold and 5 removed
- **WHEN** its stock is derived
- **THEN** the result is 35 units

#### Scenario: All removal reasons reduce stock

- **GIVEN** removals recorded under both loss-counting and non-loss reasons
- **WHEN** stock is derived
- **THEN** every removed unit reduces stock, regardless of its reason
- **AND** the loss classification does not affect the quantity on the shelf

#### Scenario: Direct modification is refused

- **WHEN** a caller attempts to set a stock level directly
- **THEN** the operation is refused
- **AND** the caller is directed to correct the underlying movement records instead

#### Scenario: A SKU with no movements has no stock record

- **WHEN** stock is requested for a store and SKU with no recorded movements
- **THEN** the system reports that no movements are known
- **AND** it SHALL NOT report a stock of zero, which would be indistinguishable from a SKU
  that sold out

#### Scenario: Deriving a period's closing stock

- **WHEN** a store's period is derived
- **THEN** closing stock per SKU is the opening balance plus restocked quantity, minus
  sold quantity, minus removed quantity, plus the net adjustment

#### Scenario: Every removal reduces stock regardless of reason

- **GIVEN** a period whose removals are all non-loss reasons
- **WHEN** stock is derived
- **THEN** those units are still subtracted from stock

#### Scenario: An inbound adjustment increases stock

- **WHEN** a period carries a positive net adjustment
- **THEN** the closing stock is higher by that quantity

#### Scenario: An outbound adjustment decreases stock

- **WHEN** a period carries a negative net adjustment
- **THEN** the closing stock is lower by that quantity

#### Scenario: Stock cannot be entered directly

- **WHEN** a caller attempts to set a stock figure
- **THEN** the request is refused
- **AND** the response directs the caller to correct the underlying movements

### Requirement: Point-in-time stock

The system SHALL derive stock as of a given period end as well as currently, using only
movements up to that point.

#### Scenario: Closing stock for a past month

- **GIVEN** a store and SKU with movements in March and April
- **WHEN** stock is derived as of the end of March
- **THEN** only March and earlier movements are included

#### Scenario: Later movements do not change a past closing figure

- **GIVEN** a closing stock derived for the end of March
- **WHEN** further movements are recorded for April
- **AND** the end-of-March figure is derived again
- **THEN** it is unchanged

### Requirement: Negative stock is surfaced, not hidden

The system SHALL report a derived stock below zero as such, and SHALL NOT clamp it to zero,
because a negative value indicates missing or wrong movement data rather than a real quantity.

#### Scenario: Negative derived stock is reported

- **GIVEN** a store and SKU whose recorded sales and removals exceed its recorded restocks
- **WHEN** its stock is derived
- **THEN** the negative value is reported
- **AND** it is flagged as an inconsistency requiring attention

#### Scenario: Negative stock does not corrupt aggregates

- **WHEN** stock is aggregated across SKUs and one is negative
- **THEN** the aggregate reports the inconsistency
- **AND** a caller can distinguish a genuine total from one containing negative components

### Requirement: Recomputation on movement changes

The system SHALL recompute affected stock when the underlying movement data changes, and
recomputation SHALL be idempotent.

#### Scenario: Ingestion triggers recomputation

- **WHEN** a store's period data changes
- **THEN** stock for that store's affected SKUs is recomputed

#### Scenario: Repeated recomputation is stable

- **WHEN** the same store and period is recomputed more than once with no data change in
  between
- **THEN** the resulting stock values are identical each time

#### Scenario: Recomputation is scoped

- **GIVEN** a change affecting one store
- **WHEN** recomputation runs
- **THEN** other stores' stock values are unchanged

### Requirement: Minimum levels

The system SHALL allow a minimum stock level to be configured per store and SKU, and SHALL
report whether current stock is at or below that minimum.

#### Scenario: Below minimum is flagged

- **GIVEN** a store and SKU with a configured minimum of 10 and derived stock of 4
- **WHEN** its stock is read
- **THEN** it is reported as below minimum

#### Scenario: No configured minimum

- **GIVEN** a store and SKU with no configured minimum
- **WHEN** its stock is read
- **THEN** no low-stock judgement is asserted for it

#### Scenario: Listing what needs restocking

- **WHEN** a store's below-minimum SKUs are requested
- **THEN** only SKUs with a configured minimum and stock at or below it are returned

### Requirement: Reads

The system SHALL expose stock for a store across its SKUs and for a single store and SKU, in
a deterministic order.

#### Scenario: Reading a store's stock

- **WHEN** stock is requested for a store
- **THEN** every SKU with recorded movements at that store is returned with its derived stock

#### Scenario: Stable ordering

- **WHEN** the same stock listing is requested twice with no data change in between
- **THEN** both responses contain the same records in the same order

### Requirement: The recorded closing balance is stored, not cross-checked

The system SHALL store the closing balance the operators recorded for a store, period and
SKU where one exists, alongside the derived figure, and SHALL NOT compare the two or report
a disagreement between them.

`Qtd. final` is a reading taken at the moment of the operation that produced it — typically
the store's last restocking visit within the period — not a month-end closing figure. Real
data shows a store's last visit of the month rarely lands on the month's last day (five real
visits across one March, the last finishing the 26th), and the sales report carries no
per-sale date, so nothing can attribute what sold before or after that visit. Comparing the
recorded reading to a whole-month derived total would flag most SKUs as disagreeing simply
because they sold anything after the last visit — not because a movement was lost or
double-counted. An earlier version of this requirement did exactly that and was reverted
after measuring it against a real store-month: the large majority of that store's SKUs came
back "disputed" with no actual data error behind any of them.

#### Scenario: The recorded balance is available alongside the derived one

- **WHEN** a recorded closing balance exists for a store, period and SKU
- **THEN** it is reported alongside the derived closing balance
- **AND** neither figure is adopted over the other, and no disagreement is computed or
  reported between them

#### Scenario: No recorded balance exists

- **WHEN** no recorded closing balance exists for a store, period and SKU
- **THEN** the derived balance is reported on its own
