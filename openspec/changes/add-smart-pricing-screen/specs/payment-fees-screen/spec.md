## Purpose

Lets the owner register and review the payment fees that the pricing engine reads, from the admin, so the rates are data with a start date and not something edited in a database.

## ADDED Requirements

### Requirement: Fees screen

The admin SHALL provide a screen at `/treasury/fees`, in the Tesouraria group, that lists the registered fees by acquirer and payment method with their rate, fixed amount per sale and start date, newest first, marks which are in force today, and shows methods with no rate as missing rather than 0%. It SHALL require the treasury read permission.

#### Scenario: A method without a rate

- **GIVEN** no voucher rate is registered
- **WHEN** the screen is opened
- **THEN** voucher is shown as having no rate, not as 0%

### Requirement: Registering a fee

A user with the treasury write permission SHALL be able to register a fee with acquirer, payment method, rate in percent, an optional fixed amount per sale in reais and a start date. The rate and the fixed amount SHALL be shown in the units the owner uses (percent and reais) and sent as basis points and centavos. A rejected fee SHALL show the reason, and a repeated acquirer / method / date SHALL be reported as a conflict, not overwritten.

#### Scenario: Registering Ticket

- **WHEN** the user registers Ticket, voucher, 5,99% with R$ 0,89 per sale from a date
- **THEN** the fee appears in the list with those values

#### Scenario: Same date twice

- **WHEN** a fee is registered for an acquirer, method and date that already exist
- **THEN** the screen reports the conflict and stores nothing

### Requirement: Registration is never silent

The screen SHALL ask for confirmation showing the acquirer, method, rate, fixed amount and start date before saving, because a wrong start date changes the margin of months already analysed. The system SHALL NOT register any fee on its own.

#### Scenario: Confirmation before saving

- **WHEN** the user submits a fee
- **THEN** a confirmation shows what will be saved and nothing is saved until it is confirmed
