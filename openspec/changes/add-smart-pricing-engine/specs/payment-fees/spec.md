## Purpose

Keeps the real cost of each payment method, per acquirer and card brand, as registered and dated data, so margin and price analysis use actual rates and any past month can be reproduced with the rate in force then.

## ADDED Requirements

### Requirement: Fees are registered per acquirer, method and effective date

The system SHALL store a fee rate per acquirer, payment method (`pix`, `debit`, `credit`, `voucher`) and effective date. Voucher brands (Pluxee, Ticket, VR Benefícios, Alelo) SHALL be registrable as distinct acquirers under the `voucher` method. Rates SHALL be stored as exact integers (basis points). An earlier rate SHALL remain readable after a newer one is registered. No rate SHALL be fixed in code.

#### Scenario: Registering a rate with a start date

- **WHEN** the owner registers PagBank `debit` at 1.39% effective 2026-01-01
- **THEN** that rate applies to dates on or after 2026-01-01
- **AND** a later rate registered for 2026-07-01 applies from that date while the earlier one stays readable for dates before it

#### Scenario: Rejecting an invalid rate

- **WHEN** a rate is registered with a negative value, a value above 100%, or an unknown payment method
- **THEN** the system rejects it with a validation error and stores nothing

### Requirement: The rate in force for a date can be read

The system SHALL return, for a given date, the rate in force for each registered acquirer and method, taking the most recent rate whose effective date is on or before that date. When no rate is registered for a method on that date, the system SHALL say so explicitly and SHALL NOT return zero.

#### Scenario: Reading a past month

- **GIVEN** PagBank `credit` at 2.97% effective 2026-01-01 and 3.50% effective 2026-08-01
- **WHEN** the rate for 2026-06-15 is read
- **THEN** it is 2.97%

#### Scenario: A method with no registered rate

- **GIVEN** no `voucher` rate is registered
- **WHEN** the rates for a date are read
- **THEN** `voucher` is reported as having no rate, not as 0%

### Requirement: The effective voucher fee averages the brands

The system SHALL derive an effective voucher fee as the average of the rates in force for all registered voucher brands. When the volume of voucher sales by brand in the period is sufficient, the average SHALL be weighted by each brand's share of that volume. Otherwise it SHALL be the simple average. The result SHALL state which of the two was used, and the simple average SHALL carry lower confidence. The sufficient-volume threshold SHALL be configurable.

#### Scenario: Weighted by real brand share

- **GIVEN** voucher sales in the period are 60% Alelo and 40% Ticket, with enough volume
- **WHEN** the effective voucher fee is derived
- **THEN** it equals 0.6 × Alelo rate + 0.4 × Ticket rate
- **AND** it is labelled as weighted by sales

#### Scenario: Not enough volume

- **GIVEN** voucher sales in the period are below the configured volume
- **WHEN** the effective voucher fee is derived
- **THEN** it equals the simple average of the brand rates
- **AND** it is labelled as a simple average with lower confidence

#### Scenario: A brand with sales but no rate

- **GIVEN** sales exist for a brand that has no registered rate
- **WHEN** the effective voucher fee is derived
- **THEN** the system reports the brand as missing a rate and does not treat it as 0%

### Requirement: The voucher share of sales comes from real sales

The system SHALL compute the share of sales paid by voucher from recorded sales for the period and scope. The share SHALL NOT be a fixed value.

#### Scenario: Share varies by store

- **GIVEN** voucher is 22% of sales in store A and 10% in store B
- **WHEN** the share is read for each store
- **THEN** store A returns 22% and store B returns 10%
