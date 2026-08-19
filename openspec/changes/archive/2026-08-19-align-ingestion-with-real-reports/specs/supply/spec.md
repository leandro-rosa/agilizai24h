## ADDED Requirements

### Requirement: Inventory adjustments

The system SHALL store inventory adjustments at the grain of store, period and SKU,
separately from restocks and from removals, and SHALL NOT let an adjustment reach the
real-loss figure.

An adjustment is stock moving between stores: the restocking operator uses the inventory
operation to bring units in from another store, and to take units out for transfer to
another store or for return to stock. Both directions occur, so the quantity is signed.
Nothing was lost in either direction — treating an outbound adjustment as loss would
overstate the figure the platform exists to report, and it would do so in exactly the
stores that lend stock most often.

#### Scenario: Recording an inbound adjustment

- **WHEN** units arrive at a store through an inventory adjustment
- **THEN** the adjustment is persisted at store, period and SKU grain with a positive quantity
- **AND** it is not recorded as a restock

#### Scenario: Recording an outbound adjustment

- **WHEN** units leave a store through an inventory adjustment
- **THEN** the adjustment is persisted with a negative quantity
- **AND** it is not recorded as a removal against any reason

#### Scenario: Adjustments never count as loss

- **GIVEN** a store and period whose only movement is an outbound adjustment
- **WHEN** real loss for that period is derived
- **THEN** the real loss is zero
- **AND** the adjustment is still reported

#### Scenario: Adjustments are reported separately from restocks and removals

- **WHEN** a store's period is read
- **THEN** the restocked quantity, the removed quantities and the net adjustment are
  reported as three distinct figures
- **AND** none of them is netted into another

## MODIFIED Requirements

### Requirement: Reads for reconciliation

The system SHALL expose, for a given store and period, the restocked quantities, the
per-reason removal quantities with their loss classification, and the net inventory
adjustment, so that a consumer can value them without re-deriving which removals count as
loss and without confusing a transfer for a purchase.

#### Scenario: Reading a period for valuation

- **WHEN** a caller requests a store's period
- **THEN** it receives restocked quantities per SKU and removal quantities per SKU and
  reason, each marked with whether the reason counts as loss

#### Scenario: Reading a period with no data

- **WHEN** a store and period that was never ingested is requested
- **THEN** the system reports that no data exists
- **AND** it SHALL NOT return zeroes, which would be indistinguishable from a period with no
  restocks or removals

#### Scenario: Reading a period including adjustments

- **WHEN** a consumer reads a store's period
- **THEN** it receives restocked quantities per SKU
- **AND** removal quantities per SKU and reason, each carrying whether it counts as loss
- **AND** the net adjustment quantity per SKU

#### Scenario: The consumer never re-derives the loss rule

- **WHEN** a consumer values real loss
- **THEN** every removal it received already states whether it counts as loss
- **AND** the consumer needs no list of reasons of its own
