## Purpose

Sends an order to the supplier by e-mail from the panel, only when a person confirms, and keeps a record of what was sent.

## ADDED Requirements

### Requirement: Preview before sending

The system SHALL show, before any send, the recipient, subject, body and attachment of the e-mail for an order. The recipient SHALL default to the supplier's registered e-mail and SHALL be editable; when the supplier has none, a send SHALL NOT be possible until one is given.

#### Scenario: Previewing

- **WHEN** an operator opens the send dialog of a requisition
- **THEN** the recipient, subject, body listing the items and quantities, and the PDF attachment are shown, and nothing has been sent

#### Scenario: No recipient

- **GIVEN** a supplier with no e-mail
- **WHEN** the operator opens the send dialog
- **THEN** sending is disabled until an address is entered

### Requirement: Sending needs explicit confirmation

The system SHALL send an e-mail only when a person confirms it in the preview, and never as a side effect of another action.

#### Scenario: Confirming

- **WHEN** the operator confirms the send
- **THEN** the e-mail is sent, the order moves to `awaiting_invoice`, and the send is recorded with recipient, subject, time and who sent it

### Requirement: A failed send changes nothing

A send that fails SHALL leave the order in its stage, SHALL be recorded with the error, and SHALL allow trying again.

#### Scenario: SMTP failure

- **WHEN** the mail server refuses the message
- **THEN** the order stays in `requisition`, the failure is recorded, and the operator is told

### Requirement: No repeated send by accident

An order that was already sent SHALL NOT be sent again unless the operator explicitly asks to send again.

#### Scenario: Sending twice

- **GIVEN** an order already sent
- **WHEN** a send is requested without the explicit resend
- **THEN** it is refused and nothing is sent

### Requirement: Sending can be tested without real e-mail

In development the system SHALL send to a local mail catcher, and real credentials SHALL be configured only by the owner.

#### Scenario: Development send

- **WHEN** an order is sent in development
- **THEN** the message arrives in the catcher and no external recipient receives it
