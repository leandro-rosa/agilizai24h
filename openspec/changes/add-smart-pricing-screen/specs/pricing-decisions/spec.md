## Purpose

Lets an authorised user turn a recommendation into a real price change with an explicit approval, and keeps a history of each decision so a price can always be traced to who changed it, from what, to what, and why. The engine never changes a price on its own.

## ADDED Requirements

### Requirement: A price changes only by an explicit approval

A product's price SHALL change only when an authorised user approves it, either by accepting the recommended price or by typing another price. Running the engine, reading the report and simulating SHALL NOT change any price. The action SHALL require the product write permission.

#### Scenario: Accepting the recommendation

- **GIVEN** a recommended price of R$ 6,50 for a product priced at R$ 5,90
- **WHEN** an authorised user applies it
- **THEN** the product has a price version of R$ 6,50 effective on the chosen date
- **AND** a decision is recorded

#### Scenario: User without write permission

- **WHEN** a user without the product write permission tries to apply a price
- **THEN** the request is refused and nothing changes

### Requirement: Every decision is recorded

Each decision SHALL record the product, the previous price, the new price, the effective date, the user, the engine's recommended price and confidence at that moment, the run and parameter version it came from, the reason, and the outcome (`applied` or `failed`). The reason SHALL be required when the new price differs from the recommendation, and optional otherwise. A new price that is not a positive whole number of centavos SHALL be rejected.

#### Scenario: Typing a different price

- **GIVEN** a recommendation of R$ 6,50
- **WHEN** the user applies R$ 6,20 without a reason
- **THEN** the request is rejected asking for a reason

#### Scenario: The decision is traceable

- **WHEN** a price is applied
- **THEN** the decision shows who applied it, the previous and new price, the recommendation at the time and the reason

### Requirement: The price write and the decision stay consistent

The decision SHALL be recorded before the price is written and marked `applied` only after the price write succeeds; if the price write fails, the decision SHALL be marked `failed` with the reason and no price SHALL be considered changed. Applying the same request twice SHALL NOT create two decisions or two price writes.

#### Scenario: Price write fails

- **GIVEN** the product service rejects the price
- **WHEN** the user applies a price
- **THEN** the decision is stored as `failed` with the reason
- **AND** the user is told the price was not changed

#### Scenario: Repeated request

- **WHEN** the same apply request is sent twice
- **THEN** there is one decision and one price write

### Requirement: A same-day change does not lose the earlier price

Because a price version is identified by its effective date, applying a second price on the same date replaces the first in the catalogue. The decision history SHALL keep the earlier price so it is never lost.

#### Scenario: Two changes on one day

- **GIVEN** a price applied today and another applied later today
- **WHEN** the history of decisions is read
- **THEN** both decisions are listed with their previous and new prices

### Requirement: Decision history is readable

The system SHALL list the decisions of a product, newest first, and the latest decisions across the catalogue, and the screen SHALL show a product's decisions in its drawer.

#### Scenario: Listing a product's decisions

- **WHEN** the decisions of a product are read
- **THEN** they are returned newest first with user, dates, prices, recommendation and reason
