## ADDED Requirements

### Requirement: Intelligence permissions

The system SHALL define three named permissions for the commercial intelligence governance register: `intelligence:read` (read the business rules, their history, parameter sets, recommendation records, decisions, outcomes and calibration reports), `intelligence:write` (register decisions, outcomes and calibration reports) and `intelligence:rules` (change business rules and review calibration reports). They SHALL be created by a migration, so that databases that already exist receive them without a manual step. The administrator role SHALL hold all three. The read-only operator role SHALL hold `intelligence:read` and neither of the others.

#### Scenario: An existing database receives the permissions

- **GIVEN** an identity database created before this change
- **WHEN** the migration is applied
- **THEN** the three permissions exist
- **AND** an existing administrator's next introspection lists all three

#### Scenario: Operators can read but not write

- **GIVEN** a user whose only role is the operator role
- **WHEN** their effective permissions are resolved
- **THEN** they include `intelligence:read`
- **AND** they include neither `intelligence:write` nor `intelligence:rules`

#### Scenario: Applying the migration twice changes nothing

- **WHEN** the migration is applied to a database that already has the permissions
- **THEN** no permission or role assignment is duplicated
