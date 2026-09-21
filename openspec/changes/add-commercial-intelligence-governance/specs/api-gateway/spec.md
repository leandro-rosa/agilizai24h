## ADDED Requirements

### Requirement: Intelligence governance routes

The system SHALL expose the commercial intelligence governance register under an `/intelligence` prefix and forward each route to the service that owns it, requiring a named permission per route: `intelligence:read` for every read, `intelligence:write` for registering decisions, outcomes and calibration reports, and `intelligence:rules` for changing a business rule and for reviewing a calibration report. For every write the system SHALL attach the user of the session as the acting user and SHALL discard any acting user, reviewer or author sent by the browser.

#### Scenario: A read without permission is refused

- **GIVEN** an authenticated caller without `intelligence:read`
- **WHEN** they read the business rules
- **THEN** the request is rejected as forbidden and the register is not called

#### Scenario: A decision needs the write permission

- **GIVEN** a caller holding only `intelligence:read`
- **WHEN** they register a decision
- **THEN** the request is rejected as forbidden

#### Scenario: Changing a rule needs the rules permission

- **GIVEN** a caller holding `intelligence:write` but not `intelligence:rules`
- **WHEN** they change a business rule
- **THEN** the request is rejected as forbidden

#### Scenario: The acting user comes from the session

- **GIVEN** a caller authenticated as user A
- **WHEN** they send a write whose body names user B as the actor
- **THEN** the register receives user A

#### Scenario: A register failure is reported as such

- **GIVEN** the register is unreachable
- **WHEN** a permitted caller requests a route that depends on it
- **THEN** the response reports an upstream failure
- **AND** the caller's session is kept and the failure is not reported as an authentication or permission problem
