## Purpose

Keeps every number that shapes a recommendation — tolerance, bands, thresholds, visit weekdays and the baseline quantity — in backend configuration with a history, so rules can be recalibrated with real data and any result can be traced to the exact values used.

## ADDED Requirements

### Requirement: Parameters live in the backend and are versioned

All thresholds, bands and tolerances that influence a result SHALL be backend configuration. No such value SHALL be fixed in the browser or only in code. Each change to the parameters SHALL create a new version; earlier versions SHALL remain readable.

#### Scenario: Recalibrating the tolerance

- **GIVEN** the default tolerance of 10% or 3 units
- **WHEN** the owner sets it to 15% or 2 units
- **THEN** a new parameter version exists and the previous one is still readable
- **AND** results computed afterwards use the new version

### Requirement: The balance tolerance is configurable

The tolerance SHALL be defined by a percentage of the system balance and a number of units, and a difference SHALL be acceptable when it is within the larger of the two. The number of recent counts considered, the minimum number of counts and the maximum age of the last count SHALL also be configurable. The initial values SHALL be 10%, 3 units, and provisional defaults for the other three that are labelled as such.

#### Scenario: Initial values

- **WHEN** the service starts with no change by the owner
- **THEN** the effective tolerance is 10% or 3 units, whichever is more permissive

### Requirement: Every result records the versions that produced it

Each stored result SHALL record the engine version and the parameter version used, and SHALL be retrievable by them, so that a past recommendation can be explained with the rules in force when it was made.

#### Scenario: Explaining an old result

- **GIVEN** a result stored under parameter version 3 while the current version is 5
- **WHEN** the result is read
- **THEN** it states version 3 and the values of version 3 are available

### Requirement: Baseline quantity is one value per SKU with a history

The baseline quantity ("qtd itens por loja") SHALL be recorded once per SKU, apply to every store, and keep an append-only history with its source and effective date. Importing it from the pricing sheet SHALL NOT overwrite earlier values. Packaging type ("Medida") SHALL be recorded as a product attribute, and a "closed pack preferred in this store" flag MAY exist per Product × Store without affecting any calculation.

#### Scenario: A baseline changes

- **GIVEN** a SKU with baseline 21 recorded in September
- **WHEN** a new import states 12
- **THEN** both values exist in the history with their dates and sources
- **AND** the current baseline is 12

#### Scenario: Closed pack preference does not change the math

- **GIVEN** a Product × Store flagged as preferring closed packs
- **WHEN** the engine runs
- **THEN** the suggested quantity is the same as without the flag
- **AND** the flag appears only as an operational option

### Requirement: Planned visit weekdays are a parameter

The planned visit weekdays SHALL be configurable, with the default Monday, Tuesday, Thursday and Friday, and an optional override per store. The engine SHALL be able to read them; they SHALL NOT be inferred silently from history.

#### Scenario: Default weekdays

- **WHEN** no override exists for a store
- **THEN** its planned visit weekdays are Monday, Tuesday, Thursday and Friday

#### Scenario: A store with another schedule

- **GIVEN** an override of Wednesday and Friday for one store
- **WHEN** that store's schedule is read
- **THEN** it is Wednesday and Friday and other stores are unchanged
