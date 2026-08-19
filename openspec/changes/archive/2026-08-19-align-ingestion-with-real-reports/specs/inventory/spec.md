## MODIFIED Requirements

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

## ADDED Requirements

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
